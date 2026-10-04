/* 端到端流程验证脚本（esbuild 打包后由 node 执行）
 * 重点覆盖：夜间跌倒告警家属5分钟未确认 → 社区值班员自动接管
 * → 电话核实无果派单 → 到达记录（时间/物业/急救）→ 家属随后响应可见已采取动作
 * → 上门结束报告门禁 → 回访后结案 → 画像沉淀；以及误报路径与非夜间不接管
 */
import { useStore } from '../src/store/useStore'
import { FAMILY_TIMEOUT_MS } from '../src/store/workflow'

const s = () => useStore.getState()
let failures = 0
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failures++
}

const find = (id: string) => s().events.find((e) => e.id === id)!

// ===================== 场景一：夜间跌倒无人响应自动升级接管（种子事件 EV-1001） =====================

// 页面加载后每秒会执行一次 tick；脚本中先手动执行一次以应用初始升级（夜间浴室场景）
s().tick()

const ev0 = find('EV-1001')
check('种子事件为夜间跌倒', ev0.type === 'fall' && ev0.isNight === true)
check('初始状态为待家属确认', ev0.status === 'pending_family')
check('浴室跌倒等级为紧急', ev0.severity === 'high')
check('已生成含上门步骤的处置流程', ev0.plan.some((p) => p.key === 'door_visit'))
check('浴室高风险场景升级已在列', ev0.escalations.some((e) => e.kind === 'night_bathroom'))
check('超时阈值为5分钟', FAMILY_TIMEOUT_MS === 5 * 60 * 1000)

// 1. 家属5分钟内未确认 → 自动升级社区值班员
s().fastForward(5)
const ev1 = find('EV-1001')
const overMs = s().now() - ev1.family.notifiedAt
check('已超过5分钟响应时限', overMs > FAMILY_TIMEOUT_MS)
check('家属超时升级已触发', ev1.escalations.some((e) => e.kind === 'family_timeout'))
check('夜间跌倒自动升级社区值班员接管', ev1.escalations.some((e) => e.kind === 'community_takeover'))
check('家属被标记为超时', ev1.family.timedOut === true)
check('接管后事件转入电话核实中', ev1.status === 'family_verifying')
check('时间线记录自动接管并推送处置卡', ev1.timeline.some((t) => t.title.includes('自动升级社区值班员接管')))
const takeoverEntry = ev1.timeline.find((t) => t.title.includes('自动升级社区值班员接管'))
check('接管处置卡含老人住址', (takeoverEntry?.detail ?? '').includes('幸福里社区 3栋 2单元 502室'))
check('接管处置卡含门禁备注', (takeoverEntry?.detail ?? '').includes('门禁'))
check('接管处置卡含钥匙托管情况', (takeoverEntry?.detail ?? '').includes('钥匙托管'))

// 2. 值班员电话核实：两次无人接
s().recordPhoneAttempt('EV-1001', 'no_answer', '响铃30秒无人接')
s().recordPhoneAttempt('EV-1001', 'no_answer', '第二次仍无人接')
const ev2 = find('EV-1001')
check('电话无人接升级已触发', ev2.escalations.some((e) => e.kind === 'phone_no_answer'))
check('电话核实记录2次', ev2.phoneAttempts.length === 2)

// 3. 电话核实无果 → 派网格员上门
s().dispatchVisit('EV-1001', '刘敏')
const ev3 = find('EV-1001')
check('已派单网格员', ev3.doorVisit?.assignee === '刘敏' && ev3.status === 'door_visit')

// 4. 网格员到达：记录到达时间、是否联系物业、是否需要急救
s().recordArrival('EV-1001', true, true)
const ev4 = find('EV-1001')
check('到达时间已记录', typeof ev4.doorVisit?.arrivedAt === 'number')
check('到达时已联系物业', ev4.doorVisit?.contactedProperty === true && ev4.doorVisit?.propertyInvolved === true)
check('到达时记录需要急救', ev4.doorVisit?.needEmergency === true)
check('需要急救已触发120升级', ev4.escalations.some((e) => e.kind === 'need_120'))

// 5. 家属“随后”才响应：能看到社区已采取的动作，且处置不被回退
const actionsBeforeFamily = ev4.timeline.filter((t) => t.actor === 'community' || t.actor === 'system').map((t) => t.title)
s().familyRespond('EV-1001', 'request_visit', '我刚看到消息，老人情况怎么样了')
const ev5 = find('EV-1001')
check('家属延迟响应已记录', ev5.family.respondedAt !== undefined && ev5.family.response === 'request_visit')
check('家属响应后处置状态不回退（仍在上门处置中）', ev5.status === 'door_visit')
check('时间线标注家属为接管后响应', ev5.timeline.some((t) => t.kind === 'confirm' && t.title.includes('接管后响应')))
check('家属可见接管动作', actionsBeforeFamily.some((t) => t.includes('接管')))
check('家属可见电话核实动作', actionsBeforeFamily.some((t) => t.includes('电话核实')))
check('家属可见派单动作', actionsBeforeFamily.some((t) => t.includes('派单网格员上门')))
check('家属可见到达动作（含物业/急救）', actionsBeforeFamily.some((t) => t.includes('网格员到达')))

// 6. 现场需医疗 → 呼叫120 → 记录就医结果
s().recordVisitResult('EV-1001', 'need_medical', '老人浴室滑倒，右髋疼痛无法起身')
s().call120('EV-1001', 'community')
s().recordMedical('EV-1001', '区人民医院骨科', '软组织挫伤，无骨折，当日返家')
const ev6 = find('EV-1001')
check('就医结果已记录并转入回访阶段', ev6.status === 'follow_up' && ev6.medical?.hospital === '区人民医院骨科')

// 7. 结案门禁：网格员未补充上门结束报告前不允许关闭
const block1 = s().closeEvent('EV-1001', 'real_risk', undefined, '试图在无上门报告时结案')
check('缺少上门结束报告时结案被阻止', typeof block1 === 'string' && block1.includes('上门结束报告'))
check('被阻止后事件仍未结案', find('EV-1001').status !== 'closed')

// 8. 网格员上门结束后补充：现场结果、老人状态、是否送医、是否复访
s().submitVisitReport('EV-1001', {
  sceneResult: '老人倒在浴室地面，右髋疼痛，网格员协助平卧保暖并陪同120送医',
  elderStatus: 'serious',
  sentToHospital: true,
  needRevisit: true,
  revisitNote: '次日上午上门复查并电话告知女儿王莉',
})
const ev7 = find('EV-1001')
check('上门结束报告已保存', !!ev7.doorVisit?.report && ev7.doorVisit.report.sceneResult.length > 0)
check('报告记录老人状态为伤情较重', ev7.doorVisit?.report.elderStatus === 'serious')
check('报告记录已送医', ev7.doorVisit.report.sentToHospital === true)
check('已送医且有就医结果后进入回访阶段', ev7.status === 'follow_up')
const block2 = s().closeEvent('EV-1001', 'real_risk', undefined, '标记需复访但尚未回访')
check('需后续复访但未回访时结案被阻止', typeof block2 === 'string' && block2.includes('复访'))

// 9. 回访后允许结案
s().recordFollowUp('EV-1001', '电话回访：老人已返家休养，儿媳陪护，明日上门复查')
const block3 = s().closeEvent('EV-1001', 'real_risk', undefined, '夜间浴室跌倒真实风险，社区5分钟超时接管链路完整，建议加装浴室防滑设施')
check('补齐报告与回访后结案成功', block3 === null && find('EV-1001').status === 'closed')
const ev8 = find('EV-1001')
check('复盘含家属响应时长', typeof ev8.closure?.familyResponseMinutes === 'number')
check('复盘含社区处置时效', (ev8.closure?.communityHandleMinutes ?? 0) > 0)
check('时间线覆盖告警/接管/确认/上门/急救/报告/回访/结案', ['alert', 'escalation', 'confirm', 'visit', 'medical', 'followup', 'close'].every((k) => ev8.timeline.some((t) => t.kind === k)))
check('时间线含上门结束报告', ev8.timeline.some((t) => t.title.includes('上门结束报告已提交')))

// 10. 画像沉淀
const p1 = s().profiles['e1']
check('画像家属无人响应+1', p1.familyTimeoutCount === 1)
check('画像真实风险+1', p1.realRiskCount === 1)
check('画像标签含真实风险', p1.riskTags.some((t) => t.includes('真实风险')))

// ===================== 场景二：接管后家属称“误报”不能终止处置 =====================
s().raiseAlert('e1', 'fall', '家-浴室', true)
const evBId = s().events[0].id
s().fastForward(6)
const evB1 = find(evBId)
check('第二条夜间跌倒同样自动接管', evB1.escalations.some((e) => e.kind === 'community_takeover') && evB1.status === 'family_verifying')
s().recordPhoneAttempt(evBId, 'no_answer', '无人接')
s().dispatchVisit(evBId, '刘敏')
s().familyRespond(evBId, 'false_alarm', '可能是手环掉地上了')
const evB2 = find(evBId)
check('接管后家属称误报不能直接结束事件', evB2.status !== 'follow_up' && evB2.status !== 'closed')
check('家属误报说法记录为延迟响应待值班员核实', evB2.timeline.some((t) => t.kind === 'confirm' && t.title.includes('误报')))

// ===================== 场景三：自动接管仅针对“夜间跌倒”，其他类型不接管 =====================
s().raiseAlert('e5', 'heart_rate', '家-浴室', true)
const evCId = s().events[0].id
s().fastForward(6)
const evC = find(evCId)
check('非跌倒告警（夜间心率异常）超时不触发自动接管', evC.family.timedOut === true && !evC.escalations.some((e) => e.kind === 'community_takeover'))

// ===================== 场景四：误报快速结案路径（无上门，不需要上门报告） =====================
const e3FalseBefore = s().profiles['e3'].falseAlarmCount
s().raiseAlert('e3', 'stillness', '家-客厅')
const evDId = s().events[0].id
s().familyRespond(evDId, 'false_alarm', '老人看电视久坐，手环误报')
s().recordFollowUp(evDId, '电话回访确认无恙')
const errD = s().closeEvent(evDId, 'device_false', '静止阈值过低（看书/看电视久坐）', '久坐误判，建议上调静止阈值')
const evD = find(evDId)
check('无上门事件不受上门报告门禁限制', errD === null && evD.status === 'closed')
check('误报建议针对阈值', evD.closure?.deviceSuggestion.includes('静止阈值') === true)
check('画像误报计数+1', s().profiles['e3'].falseAlarmCount === e3FalseBefore + 1)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
