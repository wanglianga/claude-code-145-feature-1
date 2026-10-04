/* 端到端流程验证脚本：模拟一次完整告警处置闭环（esbuild 打包后由 node 执行） */
import { useStore } from '../src/store/useStore'
import { canCloseEvent, canDispatchVisit } from '../src/store/workflow'

const s = () => useStore.getState()
const find = (id: string) => s().events.find((e) => e.id === id)!
let failures = 0
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failures++
}

// 1. 发起告警（王秀兰，浴室跌倒）
const before = s().events.length
s().raiseAlert('e1', 'fall', '家-浴室')
const ev1 = s().events[0]
check('新告警已生成', s().events.length === before + 1)
check('浴室跌倒等级为紧急', ev1.severity === 'high')
check('初始状态为待家属确认', ev1.status === 'pending_family')
check('已生成处置流程', ev1.plan.length >= 6)
check('流程含上门与120步骤', ev1.plan.some((p) => p.key === 'door_visit') && ev1.plan.some((p) => p.key === 'call_120'))
check('浴室场景触发升级', ev1.escalations.some((e) => e.kind === 'night_bathroom'))

// 2. 家属超时未响应（快进6分钟，超过5分钟时限）
s().fastForward(6)
const ev2 = find(ev1.id)
check('家属超时升级已触发', ev2.escalations.some((e) => e.kind === 'family_timeout'))
check('家属标记为超时', ev2.family.timedOut)

// 3. 电话核实两次无人接 → 升级
s().recordPhoneAttempt(ev1.id, 'no_answer', '响铃30秒无人接')
s().recordPhoneAttempt(ev1.id, 'no_answer', '')
const ev3 = find(ev1.id)
check('电话无人接升级已触发', ev3.escalations.some((e) => e.kind === 'phone_no_answer'))

// 4. 家属要求上门
s().familyRespond(ev1.id, 'request_visit', '我在外地，请社区上门')
const ev4 = find(ev1.id)
check('家属响应已记录', ev4.family.response === 'request_visit')
check('状态转为上门处置', ev4.status === 'door_visit')

// 5. 派单 → 到达登记 → 无人开门 → 物业+钥匙 → 需就医
s().dispatchVisit(ev1.id, '刘敏')
s().recordArrival(ev1.id, { propertyContacted: false, firstAidNeeded: false })
check('到达时间已记录', !!find(ev1.id).doorVisit?.arrivedAt)
s().recordVisitResult(ev1.id, 'no_answer', '敲门5分钟无人应答')
const ev5 = find(ev1.id)
check('上门无人开门升级已触发', ev5.escalations.some((e) => e.kind === 'door_no_answer'))
s().involveProperty(ev1.id, true)
const ev5b = find(ev1.id)
check('物业与托管钥匙已联动', ev5b.doorVisit?.propertyInvolved === true && ev5b.doorVisit?.usedKeyCustody === true)
s().recordVisitResult(ev1.id, 'need_medical', '老人浴室滑倒，无法起身')
const ev6 = find(ev1.id)
check('状态转为就医中', ev6.status === 'medical')
check('需联动120升级已触发', ev6.escalations.some((e) => e.kind === 'need_120'))

// 6. 120 → 就医 → 现场报告 → 回访 → 结案
s().call120(ev1.id, 'community')
s().recordMedical(ev1.id, '区人民医院骨科', '软组织挫伤，无骨折，当日返家')
const ev7 = find(ev1.id)
check('就医后转回访', ev7.status === 'follow_up' && ev7.medical?.hospital === '区人民医院骨科')
s().recordFollowUp(ev1.id, '电话回访，老人已返家休养')
s().closeEvent(ev1.id, 'real_risk', undefined, '浴室滑倒真实风险，处置链条完整，建议加装防滑设施')
check('未补现场报告时结案被拦截', find(ev1.id).status !== 'closed')
s().recordSiteReport(ev1.id, { result: '现场需医疗处置，已协助送医', elderStatus: '已送医', sentToHospital: true, needRevisit: true, note: '建议一周后复访' })
check('现场报告已补充', find(ev1.id).doorVisit?.siteReport?.sentToHospital === true)
s().closeEvent(ev1.id, 'real_risk', undefined, '浴室滑倒真实风险，处置链条完整，建议加装防滑设施')
const ev8 = find(ev1.id)
check('事件已结案', ev8.status === 'closed')
check('复盘含家属响应时长', typeof ev8.closure?.familyResponseMinutes === 'number')
check('复盘含社区处置时效', (ev8.closure?.communityHandleMinutes ?? 0) > 0)
check('复盘含设备建议', (ev8.closure?.deviceSuggestion ?? '').length > 0)
check('时间线覆盖告警到结案全流程', ['alert', 'confirm', 'visit', 'medical', 'followup', 'close'].every((k) => ev8.timeline.some((t) => t.kind === k)))

// 7. 照护画像沉淀
const p = s().profiles['e1']
check('画像真实风险+1', p.realRiskCount === 1)
check('画像家属未响应+1', p.familyTimeoutCount === 1)
check('画像上门无人+1', p.doorNoAnswerCount === 1)
check('画像标签已生成', p.riskTags.some((t) => t.includes('真实风险')) && p.riskTags.some((t) => t.includes('上门无人')))
check('照护策略已生成', p.strategy.visitFrequency.length > 0 && p.strategy.familyReminder.length > 0)

// 8. 误报结案路径（张桂芳 静止误报，无上门记录可直接结案）
const e3FalseBefore = s().profiles['e3'].falseAlarmCount
s().raiseAlert('e3', 'stillness', '家-客厅')
const evB = s().events[0]
s().familyRespond(evB.id, 'false_alarm', '老人看电视久坐，手环误报')
s().recordFollowUp(evB.id, '电话回访确认无恙')
s().closeEvent(evB.id, 'device_false', '静止阈值过低（看书/看电视久坐）', '久坐误判，建议上调静止阈值')
const evB2 = find(evB.id)
check('误报结案分类正确', evB2.closure?.category === 'device_false')
check('误报建议针对阈值', evB2.closure?.deviceSuggestion.includes('静止阈值') === true)
check('画像误报计数+1', s().profiles['e3'].falseAlarmCount === e3FalseBefore + 1)

// 9. 夜间跌倒无人响应升级值班员全流程（周淑珍 e5）
s().raiseAlert('e5', 'fall', '家-卧室', { isNight: true })
const evC0 = s().events[0]
check('夜间跌倒告警已生成', evC0.type === 'fall' && evC0.isNight)
check('夜间跌倒流程含电话核实步骤', evC0.plan.some((p) => p.key === 'phone_verify'))
s().fastForward(6)
const evC1 = find(evC0.id)
check('超时后自动升级值班员', evC1.escalations.some((e) => e.kind === 'duty_escalation') && !!evC1.dutyEscalation)
check('升级后未电话核实前禁止派单', !canDispatchVisit(evC1))
s().dispatchVisit(evC0.id, '刘敏')
check('未电话核实直接派单被拦截', !find(evC0.id).doorVisit)
s().ackDuty(evC0.id)
check('值班员已接管', !!find(evC0.id).dutyEscalation?.ackedAt)
s().recordPhoneAttempt(evC0.id, 'no_answer', '响铃40秒无人接听')
check('电话核实无果后允许派单', canDispatchVisit(find(evC0.id)))
s().dispatchVisit(evC0.id, '刘敏')
check('派单成功', find(evC0.id).doorVisit?.assignee === '刘敏')
s().recordArrival(evC0.id, { propertyContacted: true, firstAidNeeded: false, note: '物业陪同到场' })
const evC2 = find(evC0.id)
check('到达登记含物业与急救信息', evC2.doorVisit?.propertyContacted === true && evC2.doorVisit?.firstAidNeeded === false)
s().recordVisitResult(evC0.id, 'ok', '老人起夜滑倒，无外伤，已搀扶回床')
check('上门平安后转回访', find(evC0.id).status === 'follow_up')
check('有上门记录时禁止直接结案', !canCloseEvent(find(evC0.id)))
s().recordFollowUp(evC0.id, '电话回访，老人状态平稳')
s().closeEvent(evC0.id, 'real_risk', undefined, '夜间跌倒处置闭环')
check('未补现场报告结案被拦截', find(evC0.id).status !== 'closed')
s().recordSiteReport(evC0.id, { result: '已协助老人起身，观察无碍', elderStatus: '状态平稳', sentToHospital: false, needRevisit: true, note: '建议一周内复访' })
check('现场报告已记录', find(evC0.id).doorVisit?.siteReport?.needRevisit === true)
// 家属随后响应：能看到已采取动作，且不回退处置进度
s().familyRespond(evC0.id, 'request_call', '刚看到手机，母亲现在怎么样')
const evC3 = find(evC0.id)
check('家属超时后响应已记录', evC3.family.response === 'request_call' && !!evC3.family.respondedAt)
check('家属迟响应不回退处置进度', evC3.status === 'follow_up')
check('时间线可见家属迟响应记录', evC3.timeline.some((t) => t.title.includes('家属超时后响应')))
s().closeEvent(evC0.id, 'real_risk', undefined, '夜间跌倒属实，值班员升级处置闭环，建议加装夜间扶手')
const evC4 = find(evC0.id)
check('补充现场报告后允许结案', evC4.status === 'closed')
check('复盘含家属迟响应时长', typeof evC4.closure?.familyResponseMinutes === 'number')

// 10. 到达登记需要急救 → 自动联动120 → 送医路径（李建国 e2）
s().raiseAlert('e2', 'fall', '家-客厅', { isNight: true })
const evD0 = s().events[0]
s().fastForward(6)
check('第二起夜间跌倒已升级值班员', !!find(evD0.id).dutyEscalation)
s().recordPhoneAttempt(evD0.id, 'no_answer', '')
s().dispatchVisit(evD0.id, '赵强')
s().recordArrival(evD0.id, { propertyContacted: false, firstAidNeeded: true })
check('需要急救已自动联动120升级', find(evD0.id).escalations.some((e) => e.kind === 'need_120'))
s().recordVisitResult(evD0.id, 'need_medical', '老人意识模糊')
s().call120(evD0.id, 'community')
s().recordSiteReport(evD0.id, { result: '现场需医疗处置，已协助送医', elderStatus: '已送医', sentToHospital: true, needRevisit: true })
check('送医后状态为就医中', find(evD0.id).status === 'medical')
s().recordMedical(evD0.id, '区人民医院急诊', '低血糖昏迷，输液后苏醒，留观一晚')
s().recordFollowUp(evD0.id, '回访：老人已苏醒，家属到院陪护')
s().closeEvent(evD0.id, 'real_risk', undefined, '夜间跌倒伴低血糖，120联动及时')
check('送医路径事件已结案', find(evD0.id).status === 'closed')

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
