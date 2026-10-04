import { create } from 'zustand'
import {
  AlertEvent,
  AlertType,
  ALERT_TYPE_LABEL,
  CareProfile,
  ClosureCategory,
  CLOSURE_LABEL,
  Elder,
  ESCALATION_LABEL,
  EventStatus,
  Session,
  SiteReport,
  Thresholds,
  TimelineEntry,
} from '../types'
import { DUTY_STAFF, GRID_WORKERS, dutyText, seedElders, seedEvents, seedProfiles } from './seed'
import {
  assessSeverity,
  buildDeviceSuggestion,
  canCloseEvent,
  canDispatchVisit,
  checkEscalations,
  communityHandleMinutes,
  emptyProfile,
  familyResponseMinutes,
  generatePlan,
  isNightTime,
  nearestWorker,
  sedimentProfile,
} from './workflow'

let idSeq = 1002
const nextEventId = () => `EV-${++idSeq}`

export interface StoreState {
  session: Session | null
  timeOffset: number // 演示用时间快进（毫秒）
  elders: Elder[]
  events: AlertEvent[]
  profiles: Record<string, CareProfile>

  now: () => number
  login: (role: 'community' | 'family', userName: string, elderId?: string) => void
  logout: () => void
  fastForward: (minutes: number) => void
  tick: () => void

  raiseAlert: (elderId: string, type: AlertType, location: string, opts?: { isNight?: boolean }) => void
  familyRespond: (eventId: string, response: NonNullable<AlertEvent['family']['response']>, note: string) => void
  recordPhoneAttempt: (eventId: string, result: 'answered' | 'no_answer', note: string) => void
  ackDuty: (eventId: string) => void
  dispatchVisit: (eventId: string, assignee: string) => void
  recordArrival: (eventId: string, info: { propertyContacted: boolean; firstAidNeeded: boolean; note?: string }) => void
  recordVisitResult: (eventId: string, result: 'ok' | 'no_answer' | 'need_medical', note: string) => void
  recordSiteReport: (eventId: string, report: { result: string; elderStatus: string; sentToHospital: boolean; needRevisit: boolean; note?: string }) => void
  involveProperty: (eventId: string, useKey: boolean) => void
  call120: (eventId: string, by: 'family' | 'community') => void
  recordMedical: (eventId: string, hospital: string, outcome: string) => void
  recordFollowUp: (eventId: string, note: string) => void
  closeEvent: (eventId: string, category: ClosureCategory, falseReason: string | undefined, summary: string) => void

  updateThresholds: (elderId: string, t: Thresholds) => void
  updateWearingHabit: (elderId: string, habit: string) => void
  updateStrategy: (elderId: string, strategy: CareProfile['strategy']) => void
}

function pushTimeline(ev: AlertEvent, entry: TimelineEntry): AlertEvent {
  return { ...ev, timeline: [...ev.timeline, entry] }
}

function applyEscalations(ev: AlertEvent, elder: Elder, now: number): AlertEvent {
  const fresh = checkEscalations(ev, elder, now)
  if (!fresh.length) return ev
  let next = { ...ev, escalations: [...ev.escalations] }
  for (const f of fresh) {
    next.escalations.push({ kind: f.kind, at: now, note: f.note })
    next = pushTimeline(next, { at: now, actor: 'system', kind: 'escalation', title: `升级：${ESCALATION_LABEL[f.kind]}`, detail: f.note })
    if (f.kind === 'family_timeout') next.family = { ...next.family, timedOut: true }
    if (f.kind === 'duty_escalation' && !next.dutyEscalation) next.dutyEscalation = { escalatedAt: now }
  }
  return next
}

export const useStore = create<StoreState>((set, get) => {
  const boot = Date.now()
  return {
    session: null,
    timeOffset: 0,
    elders: seedElders(boot),
    events: seedEvents(boot),
    profiles: seedProfiles(boot),

    now: () => Date.now() + get().timeOffset,

    login: (role, userName, elderId) => set({ session: { role, userName, elderId } }),
    logout: () => set({ session: null }),

    fastForward: (minutes) => {
      set((s) => ({ timeOffset: s.timeOffset + minutes * 60 * 1000 }))
      get().tick()
    },

    /** 周期性检查所有未结案事件的升级情形 */
    tick: () => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.status === 'closed') return ev
          const elder = s.elders.find((e) => e.id === ev.elderId)
          if (!elder) return ev
          return applyEscalations(ev, elder, now)
        }),
      }))
    },

    /** 手环上报新告警（opts.isNight 供演示/自测指定夜间场景） */
    raiseAlert: (elderId, type, location, opts) => {
      const s = get()
      const elder = s.elders.find((e) => e.id === elderId)
      if (!elder) return
      const now = s.now()
      const isNight = opts?.isNight ?? isNightTime(new Date(now))
      const severity = assessSeverity(type, {
        isNight,
        location,
        battery: elder.battery,
        historyFalseAlarms: elder.historyFalseAlarms,
      })
      const contact = [...elder.contacts].sort((a, b) => a.priority - b.priority)[0]
      let ev: AlertEvent = {
        id: nextEventId(),
        elderId,
        type,
        severity,
        location,
        isNight,
        occurredAt: now,
        batteryAtAlert: elder.battery,
        status: 'pending_family',
        plan: generatePlan({
          elder,
          type,
          location,
          isNight,
          battery: elder.battery,
          severity,
          gridWorkers: GRID_WORKERS,
          dutyText,
        }),
        escalations: [],
        family: { contactName: contact.name, contactPhone: contact.phone, notifiedAt: now, timedOut: false },
        phoneAttempts: [],
        timeline: [
          { at: now, actor: 'device', kind: 'alert', title: `手环上报${ALERT_TYPE_LABEL[type]}`, detail: `位置：${location}${isNight ? '，夜间时段' : ''}` },
          { at: now, actor: 'system', kind: 'handle', title: '已通知紧急联系人', detail: `短信+APP推送：${contact.name}（${contact.relation}）${contact.phone}` },
        ],
      }
      ev = applyEscalations(ev, elder, now)
      set((st) => ({ events: [ev, ...st.events] }))
    },

    /** 家属端操作（超时升级后响应：记录响应并同步已采取动作，不回退社区处置进度） */
    familyRespond: (eventId, response, note) => {
      const now = get().now()
      const labelMap = {
        false_alarm: '家属确认误报',
        request_call: '家属请求电话核实',
        request_visit: '家属要求上门',
        called_120: '家属直接拨打120',
      } as const
      const statusMap: Record<typeof response, EventStatus> = {
        false_alarm: 'follow_up',
        request_call: 'family_verifying',
        request_visit: 'door_visit',
        called_120: 'medical',
      }
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId || ev.family.respondedAt) return ev
          const late = ev.family.timedOut
          // 值班员已接管且社区已在处置：家属迟到的响应不回退进度（直接呼救120除外）
          const communityEngaged = ev.dutyEscalation != null && ev.status !== 'pending_family'
          let status = statusMap[response]
          if (communityEngaged && response !== 'called_120') {
            status = ev.status
            if (response === 'request_visit' && !ev.doorVisit) status = 'door_visit'
          }
          let next: AlertEvent = {
            ...ev,
            status,
            family: { ...ev.family, respondedAt: now, response, note },
          }
          next = pushTimeline(next, {
            at: now,
            actor: 'family',
            kind: 'confirm',
            title: late ? `家属超时后响应：${labelMap[response]}` : labelMap[response],
            detail: [note, communityEngaged ? '社区处置继续进行，已采取的动作已向家属同步' : ''].filter(Boolean).join('；') || undefined,
          })
          if (response === 'called_120') {
            next.medical = { called120: true, at: now }
            next.escalations = [...next.escalations, { kind: 'need_120', at: now, note: '家属已直接拨打120，社区同步联动' }]
            next = pushTimeline(next, { at: now, actor: 'system', kind: 'escalation', title: '升级：需联动120急救', detail: '家属已拨打120，社区值班员同步跟进' })
          }
          return next
        }),
      }))
    },

    /** 社区电话核实 */
    recordPhoneAttempt: (eventId, result, note) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId) return ev
          const by = s.session?.userName ?? '值班员'
          let next: AlertEvent = { ...ev, phoneAttempts: [...ev.phoneAttempts, { at: now, by, result, note }] }
          next = pushTimeline(next, {
            at: now,
            actor: 'community',
            kind: 'handle',
            title: result === 'answered' ? '电话核实：老人接听' : '电话核实：无人接听',
            detail: note || undefined,
          })
          if (result === 'answered') {
            // 接通后确认无异常 → 进入回访结案
            next.status = 'follow_up'
            next = pushTimeline(next, { at: now, actor: 'community', kind: 'handle', title: '电话确认老人状态平稳', detail: '转入回访结案流程' })
          }
          const elder = s.elders.find((e) => e.id === ev.elderId)
          return elder ? applyEscalations(next, elder, now) : next
        }),
      }))
    },

    /** 值班员接管夜间跌倒无人响应升级事件 */
    ackDuty: (eventId) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId || !ev.dutyEscalation || ev.dutyEscalation.ackedAt || ev.status === 'closed') return ev
          const by = s.session?.userName ?? '值班员'
          let next: AlertEvent = { ...ev, dutyEscalation: { ...ev.dutyEscalation, ackedAt: now, ackedBy: by } }
          return pushTimeline(next, {
            at: now,
            actor: 'community',
            kind: 'handle',
            title: `值班员${by}已接管`,
            detail: '夜间跌倒家属未确认升级事件，开始电话核实老人情况',
          })
        }),
      }))
    },

    /** 派单上门（值班员升级事件须先电话核实无果，家属主动要求上门除外） */
    dispatchVisit: (eventId, assignee) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId || !canDispatchVisit(ev)) return ev
          let next: AlertEvent = {
            ...ev,
            status: 'door_visit',
            doorVisit: { dispatchedAt: now, assignee, propertyInvolved: false, usedKeyCustody: false },
          }
          return pushTimeline(next, { at: now, actor: 'community', kind: 'visit', title: '派单网格员上门', detail: `${assignee} 已接单出发` })
        }),
      }))
    },

    /** 到达登记：记录到达时间、是否联系物业、是否需要急救 */
    recordArrival: (eventId, info) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId || !ev.doorVisit) return ev
          let next: AlertEvent = {
            ...ev,
            doorVisit: {
              ...ev.doorVisit,
              arrivedAt: now,
              propertyContacted: info.propertyContacted,
              firstAidNeeded: info.firstAidNeeded,
              arrivalNote: info.note,
            },
          }
          next = pushTimeline(next, {
            at: now,
            actor: 'community',
            kind: 'visit',
            title: '网格员到达老人家门口',
            detail: [
              info.propertyContacted ? `已联系物业（${DUTY_STAFF[2].role}${DUTY_STAFF[2].name}）` : '未联系物业',
              info.firstAidNeeded ? '现场判断需要急救' : '暂不需要急救',
              info.note,
            ]
              .filter(Boolean)
              .join('；'),
          })
          if (info.firstAidNeeded && !next.escalations.some((e) => e.kind === 'need_120')) {
            next.escalations = [...next.escalations, { kind: 'need_120', at: now, note: '网格员到达现场后判断需要急救，请值班员立即联动120' }]
            next = pushTimeline(next, { at: now, actor: 'system', kind: 'escalation', title: '升级：需联动120急救', detail: '网格员现场判断需要急救' })
          }
          return next
        }),
      }))
    },

    /** 上门结果 */
    recordVisitResult: (eventId, result, note) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId || !ev.doorVisit) return ev
          let next: AlertEvent = { ...ev, doorVisit: { ...ev.doorVisit, result, note } }
          const titleMap = { ok: '上门确认老人平安', no_answer: '上门无人开门', need_medical: '上门发现需医疗处置' }
          next = pushTimeline(next, { at: now, actor: 'community', kind: 'visit', title: titleMap[result], detail: note || undefined })
          if (result === 'ok') next.status = 'follow_up'
          if (result === 'need_medical') {
            next.status = 'medical'
            next.escalations = [...next.escalations, { kind: 'need_120', at: now, note: '现场确认需医疗救援' }]
            next = pushTimeline(next, { at: now, actor: 'system', kind: 'escalation', title: '升级：需联动120急救', detail: '网格员现场确认需医疗救援' })
          }
          const elder = s.elders.find((e) => e.id === ev.elderId)
          return elder ? applyEscalations(next, elder, now) : next
        }),
      }))
    },

    /** 上门结束后网格员补充现场报告（现场结果/老人状态/是否送医/是否复访），结案前必填 */
    recordSiteReport: (eventId, report) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId || !ev.doorVisit || ev.doorVisit.siteReport || ev.status === 'closed') return ev
          const by = ev.doorVisit.assignee
          const siteReport: SiteReport = { ...report, at: now, by }
          let next: AlertEvent = { ...ev, doorVisit: { ...ev.doorVisit, siteReport } }
          next = pushTimeline(next, {
            at: now,
            actor: 'community',
            kind: 'visit',
            title: '网格员补充现场报告',
            detail: `现场结果：${report.result}；老人状态：${report.elderStatus}；${report.sentToHospital ? '已送医' : '未送医'}；${
              report.needRevisit ? '需要后续复访' : '无需复访'
            }${report.note ? `；${report.note}` : ''}`,
          })
          // 送医：转入就医流程，需补记就医结果（已记录就医结果的不再回退）
          if (report.sentToHospital && next.status !== 'medical' && !next.medical?.outcome) {
            next.status = 'medical'
            next = pushTimeline(next, { at: now, actor: 'system', kind: 'medical', title: '老人已送医', detail: '请值班员补记送医医院与诊断结果' })
          }
          return next
        }),
      }))
    },

    /** 联动物业/托管钥匙开门 */
    involveProperty: (eventId, useKey) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId || !ev.doorVisit) return ev
          let next: AlertEvent = { ...ev, doorVisit: { ...ev.doorVisit, propertyInvolved: true, usedKeyCustody: useKey } }
          if (!next.escalations.some((e) => e.kind === 'need_property')) {
            next.escalations = [...next.escalations, { kind: 'need_property', at: now, note: '上门无人开门，联动物业协助入户' }]
          }
          next = pushTimeline(next, {
            at: now,
            actor: 'community',
            kind: 'handle',
            title: useKey ? '联动物业并使用托管钥匙入户' : '联动物业协助开门',
            detail: useKey ? `物业值班 ${DUTY_STAFF[2].name} 到场，使用社区托管备用钥匙` : `物业值班 ${DUTY_STAFF[2].name} 到场协助`,
          })
          return next
        }),
      }))
    },

    /** 呼叫120 */
    call120: (eventId, by) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId) return ev
          let next: AlertEvent = { ...ev, status: 'medical', medical: { called120: true, at: now } }
          if (!next.escalations.some((e) => e.kind === 'need_120')) {
            next.escalations = [...next.escalations, { kind: 'need_120', at: now, note: by === 'community' ? '社区值班员呼叫120' : '家属呼叫120' }]
          }
          return pushTimeline(next, {
            at: now,
            actor: by === 'community' ? 'community' : 'family',
            kind: 'medical',
            title: '呼叫120急救',
            detail: '已同步老人慢病史与用药信息',
          })
        }),
      }))
    },

    /** 记录就医结果 */
    recordMedical: (eventId, hospital, outcome) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId) return ev
          let next: AlertEvent = {
            ...ev,
            status: 'follow_up',
            medical: { called120: ev.medical?.called120 ?? false, at: ev.medical?.at ?? now, hospital, outcome },
          }
          return pushTimeline(next, { at: now, actor: 'medical', kind: 'medical', title: `送医：${hospital}`, detail: outcome })
        }),
      }))
    },

    /** 回访记录 */
    recordFollowUp: (eventId, note) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId) return ev
          const by = s.session?.userName ?? '值班员'
          let next: AlertEvent = { ...ev, followUp: { at: now, by, note } }
          return pushTimeline(next, { at: now, actor: 'community', kind: 'followup', title: '回访完成', detail: note })
        }),
      }))
    },

    /** 结案：生成复盘报告并沉淀照护画像（有上门记录的事件须先补充现场报告） */
    closeEvent: (eventId, category, falseReason, summary) => {
      const now = get().now()
      set((s) => {
        const ev = s.events.find((e) => e.id === eventId)
        if (!ev || !canCloseEvent(ev)) return s
        const elder = s.elders.find((e) => e.id === ev.elderId)!
        const closure = {
          closedAt: now,
          closedBy: s.session?.userName ?? '值班员',
          category,
          falseReason,
          deviceSuggestion: buildDeviceSuggestion(category, falseReason, ev, elder),
          familyResponseMinutes: familyResponseMinutes(ev, now),
          communityHandleMinutes: communityHandleMinutes(ev, now),
          summary,
        }
        let next = pushTimeline(
          { ...ev, status: 'closed', closure },
          { at: now, actor: 'community', kind: 'close', title: '事件结案', detail: `分类：${CLOSURE_LABEL[category]}` },
        )
        const profile = sedimentProfile(s.profiles[ev.elderId] ?? emptyProfile(ev.elderId, now), next, closure, now)
        return {
          events: s.events.map((e) => (e.id === eventId ? next : e)),
          profiles: { ...s.profiles, [ev.elderId]: profile },
        }
      })
    },

    updateThresholds: (elderId, t) =>
      set((s) => ({ elders: s.elders.map((e) => (e.id === elderId ? { ...e, thresholds: t } : e)) })),
    updateWearingHabit: (elderId, habit) =>
      set((s) => ({ elders: s.elders.map((e) => (e.id === elderId ? { ...e, wearingHabit: habit } : e)) })),
    updateStrategy: (elderId, strategy) =>
      set((s) => {
        const p = s.profiles[elderId] ?? emptyProfile(elderId, s.now())
        return { profiles: { ...s.profiles, [elderId]: { ...p, strategy, updatedAt: s.now() } } }
      }),
  }
})

export { GRID_WORKERS, DUTY_STAFF, nearestWorker }
