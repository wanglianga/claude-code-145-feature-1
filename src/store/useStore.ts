import { create } from 'zustand'
import {
  AlertEvent,
  AlertType,
  ALERT_TYPE_LABEL,
  CareProfile,
  ClosureCategory,
  CLOSURE_LABEL,
  DoorVisitReport,
  Elder,
  ESCALATION_LABEL,
  EventStatus,
  Session,
  Thresholds,
  TimelineEntry,
} from '../types'
import { DUTY_STAFF, GRID_WORKERS, dutyText, seedElders, seedEvents, seedProfiles } from './seed'
import {
  assessSeverity,
  buildDeviceSuggestion,
  checkEscalations,
  closureBlockers,
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

  raiseAlert: (elderId: string, type: AlertType, location: string, forceNight?: boolean) => void
  familyRespond: (eventId: string, response: NonNullable<AlertEvent['family']['response']>, note: string) => void
  recordPhoneAttempt: (eventId: string, result: 'answered' | 'no_answer', note: string) => void
  dispatchVisit: (eventId: string, assignee: string) => void
  recordArrival: (eventId: string, contactedProperty: boolean, needEmergency: boolean) => void
  recordVisitResult: (eventId: string, result: 'ok' | 'no_answer' | 'need_medical', note: string) => void
  submitVisitReport: (eventId: string, report: Omit<DoorVisitReport, 'reportedAt' | 'reportedBy'>) => void
  involveProperty: (eventId: string, useKey: boolean) => void
  call120: (eventId: string, by: 'family' | 'community') => void
  recordMedical: (eventId: string, hospital: string, outcome: string) => void
  recordFollowUp: (eventId: string, note: string) => void
  /** 结案；若未满足结案门禁返回阻止原因，否则返回 null */
  closeEvent: (eventId: string, category: ClosureCategory, falseReason: string | undefined, summary: string) => string | null

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
    if (f.kind === 'community_takeover' && next.status === 'pending_family') {
      // 夜间跌倒无人确认：自动升级社区值班员接管，先开展电话核实
      next.status = 'family_verifying'
      next = pushTimeline(next, {
        at: now,
        actor: 'system',
        kind: 'handle',
        title: '已自动升级社区值班员接管',
        detail: `处置卡已推送：${elder.address}；门禁备注：${elder.accessInfo}；钥匙托管：${elder.keyCustody}。值班员先电话核实老人，无果即派网格员上门`,
      })
    }
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

    /** 手环上报新告警（forceNight 用于演示/测试强制按夜间场景判定） */
    raiseAlert: (elderId, type, location, forceNight = false) => {
      const s = get()
      const elder = s.elders.find((e) => e.id === elderId)
      if (!elder) return
      const now = s.now()
      const isNight = forceNight || isNightTime(new Date(now))
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

    /** 家属端操作（社区接管后家属再响应：记录在案并同步给处置人员，不回退已采取的处置状态） */
    familyRespond: (eventId, response, note) => {
      const now = get().now()
      const labelMap = {
        false_alarm: '家属确认误报',
        request_call: '家属请求电话核实',
        request_visit: '家属要求上门',
        called_120: '家属直接拨打120',
      } as const
      const targetStatus: Record<typeof response, EventStatus> = {
        false_alarm: 'follow_up',
        request_call: 'family_verifying',
        request_visit: 'door_visit',
        called_120: 'medical',
      }
      const statusRank: Record<EventStatus, number> = {
        pending_family: 0,
        family_verifying: 1,
        door_visit: 2,
        medical: 3,
        follow_up: 4,
        closed: 5,
      }
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId || ev.family.respondedAt) return ev
          const takenOver = ev.family.timedOut || ev.escalations.some((e) => e.kind === 'community_takeover')
          let next: AlertEvent = {
            ...ev,
            family: { ...ev.family, respondedAt: now, response, note },
          }
          if (!takenOver) {
            next.status = targetStatus[response]
          } else if (response === 'false_alarm') {
            // 社区已接管，家属所称误报不能直接终止处置，维持当前状态由值班员核实
            next = pushTimeline(next, {
              at: now,
              actor: 'family',
              kind: 'confirm',
              title: '家属延迟响应：称可能为误报',
              detail: `社区已接管处置，家属留言：${note || '（无）'}。值班员结合现场核实结果决定是否继续处置`,
            })
            return next
          } else if (response !== 'called_120') {
            // 请求电话核实/要求上门：仅当社区处置尚未推进到该阶段时前移，不回退
            if (statusRank[next.status] < statusRank[targetStatus[response]]) next.status = targetStatus[response]
          }
          next = pushTimeline(next, {
            at: now,
            actor: 'family',
            kind: 'confirm',
            title: takenOver ? `家属在社区接管后响应：${labelMap[response]}` : labelMap[response],
            detail: note || (takenOver ? '家属可在事件全程记录中查看社区已采取的动作' : undefined),
          })
          if (response === 'called_120') {
            if (statusRank[next.status] < statusRank['medical']) next.status = 'medical'
            next.medical = { called120: true, at: now }
            if (!next.escalations.some((e) => e.kind === 'need_120')) {
              next.escalations = [...next.escalations, { kind: 'need_120', at: now, note: '家属已直接拨打120，社区同步联动' }]
            }
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

    /** 派单上门 */
    dispatchVisit: (eventId, assignee) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId) return ev
          let next: AlertEvent = {
            ...ev,
            status: 'door_visit',
            doorVisit: { dispatchedAt: now, assignee, propertyInvolved: false, usedKeyCustody: false },
          }
          return pushTimeline(next, { at: now, actor: 'community', kind: 'visit', title: '派单网格员上门', detail: `${assignee} 已接单出发` })
        }),
      }))
    },

    recordArrival: (eventId, contactedProperty, needEmergency) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId || !ev.doorVisit) return ev
          const dv = { ...ev.doorVisit, arrivedAt: now, contactedProperty, needEmergency }
          let next: AlertEvent = { ...ev, doorVisit: dv }
          next = pushTimeline(next, {
            at: now,
            actor: 'community',
            kind: 'visit',
            title: `网格员到达老人家门口${contactedProperty ? '，已联系物业' : ''}${needEmergency ? '，现场判断需要急救' : ''}`,
            detail: `到达时间已记录；${contactedProperty ? '物业值班同步到场/待命；' : ''}${needEmergency ? '请立即呼叫120急救' : '暂不需要急救'}`,
          })
          if (contactedProperty && !dv.propertyInvolved) {
            next = { ...next, doorVisit: { ...dv, propertyInvolved: true } }
          }
          if (needEmergency && !next.escalations.some((e) => e.kind === 'need_120')) {
            next.escalations = [...next.escalations, { kind: 'need_120', at: now, note: '网格员到达现场判断需要急救' }]
            next = pushTimeline(next, { at: now, actor: 'system', kind: 'escalation', title: '升级：需联动120急救', detail: '网格员现场判断需要急救，请立即呼叫120' })
          }
          return next
        }),
      }))
    },

    /** 入户初步结果（无人开门 / 平安 / 需医疗）；上门结束需另行 submitVisitReport 补齐报告 */
    recordVisitResult: (eventId, result, note) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId || !ev.doorVisit) return ev
          let next: AlertEvent = { ...ev, doorVisit: { ...ev.doorVisit, result, note } }
          const titleMap = { ok: '入户确认老人在场', no_answer: '上门无人开门', need_medical: '上门发现需医疗处置' }
          next = pushTimeline(next, { at: now, actor: 'community', kind: 'visit', title: titleMap[result], detail: note || undefined })
          if (result === 'need_medical') {
            next.status = 'medical'
            if (!next.escalations.some((e) => e.kind === 'need_120')) {
              next.escalations = [...next.escalations, { kind: 'need_120', at: now, note: '现场确认需医疗救援' }]
            }
            next = pushTimeline(next, { at: now, actor: 'system', kind: 'escalation', title: '升级：需联动120急救', detail: '网格员现场确认需医疗救援' })
          }
          const elder = s.elders.find((e) => e.id === ev.elderId)
          return elder ? applyEscalations(next, elder, now) : next
        }),
      }))
    },

    /** 网格员上门结束后补充现场结果、老人状态、是否送医、是否复访 */
    submitVisitReport: (eventId, report) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId || !ev.doorVisit) return ev
          const by = s.session?.userName ?? ev.doorVisit.assignee
          const full: DoorVisitReport = { ...report, reportedAt: now, reportedBy: by }
          let next: AlertEvent = { ...ev, doorVisit: { ...ev.doorVisit, report: full } }
          next = pushTimeline(next, {
            at: now,
            actor: 'community',
            kind: 'visit',
            title: '上门结束报告已提交',
            detail: `现场结果：${report.sceneResult}；老人状态：${report.elderStatus === 'good' ? '平安无碍' : report.elderStatus === 'minor' ? '轻伤/受惊吓' : '伤情较重'}；${
              report.sentToHospital ? '已送医' : '未送医'
            }；${report.needRevisit ? `需要后续复访（${report.revisitNote || '待安排'}）` : '无需后续复访'}`,
          })
          if (report.sentToHospital) {
            if (!next.medical) next.medical = { called120: ev.doorVisit.needEmergency ?? false }
            if (!next.escalations.some((e) => e.kind === 'need_120') && (ev.doorVisit.needEmergency || report.elderStatus === 'serious')) {
              next.escalations = [...next.escalations, { kind: 'need_120', at: now, note: '上门结束报告：老人已送医' }]
            }
            // 已记录就医结果则进入回访，否则留在就医中补录
            next.status = next.medical.outcome ? 'follow_up' : 'medical'
          } else {
            next.status = 'follow_up'
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
            medical: { called120: ev.medical?.called120 ?? true, at: ev.medical?.at ?? now, hospital, outcome },
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

    /** 结案：生成复盘报告并沉淀照护画像；未满足结案门禁时返回阻止原因 */
    closeEvent: (eventId, category, falseReason, summary) => {
      const s = get()
      const ev = s.events.find((e) => e.id === eventId)
      if (!ev) return '事件不存在'
      const blockers = closureBlockers(ev)
      if (blockers.length) return blockers[0]
      const now = s.now()
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
      const next = pushTimeline(
        { ...ev, status: 'closed', closure },
        { at: now, actor: 'community', kind: 'close', title: '事件结案', detail: `分类：${CLOSURE_LABEL[category]}` },
      )
      const profile = sedimentProfile(s.profiles[ev.elderId] ?? emptyProfile(ev.elderId, now), next, closure, now)
      set({
        events: s.events.map((e) => (e.id === eventId ? next : e)),
        profiles: { ...s.profiles, [ev.elderId]: profile },
      })
      return null
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
