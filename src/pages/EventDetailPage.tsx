import React, { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Form,
  Input,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd'
import {
  ArrowLeftOutlined,
  EnvironmentOutlined,
  KeyOutlined,
  LockOutlined,
  PhoneOutlined,
  SafetyOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useStore, GRID_WORKERS, nearestWorker } from '../store/useStore'
import { CLOSURE_LABEL, ClosureCategory, ELDER_STATUS_LABEL, ESCALATION_LABEL, DoorVisitReport } from '../types'
import { FALSE_REASONS, closureBlockers } from '../store/workflow'
import { AlertTypeTag, SeverityTag, StatusTag, fmtMinutes, fmtTime } from '../components/common'
import ElderInfoCard from '../components/ElderInfoCard'
import PlanSteps from '../components/PlanSteps'
import EventTimeline from '../components/EventTimeline'

const { Text, Title } = Typography

const FAMILY_RESP_LABEL = {
  false_alarm: '确认误报',
  request_call: '请求电话核实',
  request_visit: '要求上门',
  called_120: '已拨打120',
} as const

const EventDetailPage: React.FC = () => {
  const { id } = useParams()
  const nav = useNavigate()
  const store = useStore()
  const ev = store.events.find((e) => e.id === id)
  const elder = store.elders.find((e) => e.id === ev?.elderId)
  const [familyNote, setFamilyNote] = useState('')
  const [phoneNote, setPhoneNote] = useState('')
  const [arrivalModal, setArrivalModal] = useState(false)
  const [contactedProperty, setContactedProperty] = useState(false)
  const [needEmergency, setNeedEmergency] = useState(false)
  const [visitResult, setVisitResult] = useState<'ok' | 'no_answer' | 'need_medical'>('ok')
  const [visitNote, setVisitNote] = useState('')
  const [visitResultModal, setVisitResultModal] = useState(false)
  const [reportModal, setReportModal] = useState(false)
  const [reportForm] = Form.useForm()
  const reportStatus = Form.useWatch('elderStatus', reportForm)
  const [medicalModal, setMedicalModal] = useState(false)
  const [medicalForm] = Form.useForm()
  const [followUpModal, setFollowUpModal] = useState(false)
  const [followUpNote, setFollowUpNote] = useState('')
  const [closeModal, setCloseModal] = useState(false)
  const [closeForm] = Form.useForm()
  const closeCategory = Form.useWatch('category', closeForm)

  const takenOver = useMemo(
    () => !!ev && (ev.family.timedOut || ev.escalations.some((e) => e.kind === 'community_takeover')),
    [ev],
  )
  const blockers = useMemo(() => (ev ? closureBlockers(ev) : []), [ev])

  if (!ev || !elder) {
    return (
      <Card>
        <Text>事件不存在。</Text>
        <Button onClick={() => nav('/')}>返回工作台</Button>
      </Card>
    )
  }

  const closed = ev.status === 'closed'
  const worker = nearestWorker(elder, GRID_WORKERS)
  const phoneTriedNoAnswer = ev.phoneAttempts.some((a) => a.result === 'no_answer')
  const dv = ev.doorVisit
  const report: DoorVisitReport | undefined = dv?.report

  const familyAct = (response: 'false_alarm' | 'request_call' | 'request_visit' | 'called_120') => {
    store.familyRespond(ev.id, response, familyNote)
    setFamilyNote('')
    message.success(takenOver ? '家属的延迟响应已记录，社区处置继续推进' : '家属操作已记录')
  }

  const doClose = () => {
    closeForm.validateFields().then((v) => {
      const err = store.closeEvent(ev.id, v.category, v.falseReason, v.summary)
      if (err) {
        message.error(`暂不能结案：${err}`)
        return
      }
      setCloseModal(false)
      message.success('已结案，复盘报告已生成并沉淀至照护画像')
    })
  }

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Button icon={<ArrowLeftOutlined />} onClick={() => nav('/')}>
          返回
        </Button>
        <Title level={4} style={{ margin: 0 }}>
          事件 {ev.id} · {elder.name}
        </Title>
        <AlertTypeTag v={ev.type} />
        <SeverityTag v={ev.severity} />
        <StatusTag v={ev.status} />
        <Text type="secondary">
          {fmtTime(ev.occurredAt)} · {ev.location}
          {ev.isNight && <Tag color="purple">夜间</Tag>}
        </Text>
      </Space>

      {ev.escalations.length > 0 && !closed && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="已触发升级情形"
          description={
            <Space direction="vertical" size={2}>
              {ev.escalations.map((e, i) => (
                <Text key={i} style={{ fontSize: 12 }}>
                  <Tag color={e.kind === 'community_takeover' ? 'red' : 'orange'}>{ESCALATION_LABEL[e.kind]}</Tag>
                  {fmtTime(e.at)} · {e.note}
                </Text>
              ))}
            </Space>
          }
        />
      )}

      {/* 夜间跌倒无人响应：社区值班员自动接管处置卡 */}
      {takenOver && !closed && (
        <Card
          size="small"
          style={{ marginBottom: 12, borderColor: '#ff4d4f', borderWidth: 1.5, background: '#fff2f0' }}
          title={
            <Space wrap>
              <ThunderboltOutlined style={{ color: '#ff4d4f' }} />
              <Text strong style={{ color: '#cf1322' }}>
                升级处置卡 · 社区值班员已接管
              </Text>
              <Tag color="red">{ev.family.timedOut ? '家属5分钟未确认' : ''}</Tag>
            </Space>
          }
        >
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label={<><EnvironmentOutlined /> 老人住址</>}>
                  <Text strong>{elder.address}</Text>
                </Descriptions.Item>
                <Descriptions.Item label={<><LockOutlined /> 门禁备注</>}>{elder.accessInfo}</Descriptions.Item>
                <Descriptions.Item label={<><KeyOutlined /> 钥匙托管</>}>{elder.keyCustody}</Descriptions.Item>
              </Descriptions>
            </Col>
            <Col xs={24} md={12}>
              <Text strong style={{ fontSize: 12 }}>
                最近活动
              </Text>
              <Timeline
                style={{ marginTop: 8, marginBottom: 0 }}
                items={elder.trajectory.map((t) => ({
                  children: (
                    <Text style={{ fontSize: 12 }}>
                      {fmtTime(t.at)} {t.place}
                    </Text>
                  ),
                }))}
              />
            </Col>
          </Row>
          <Alert
            style={{ marginTop: 8 }}
            type="info"
            showIcon
            message="请先电话核实老人情况；电话核实无果（无人接听）后立即派网格员上门，到达后记录到达时间、是否联系物业与是否需要急救。"
          />
        </Card>
      )}

      <Row gutter={12}>
        {/* 左：老人与设备信息（社区视角） */}
        <Col xs={24} lg={7}>
          <ElderInfoCard elder={elder} communityView />
          <Card size="small" title="家属响应状态" style={{ marginBottom: 12 }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="第一联系人">
                {ev.family.contactName}（{ev.family.contactPhone}）
              </Descriptions.Item>
              <Descriptions.Item label="通知时间">{fmtTime(ev.family.notifiedAt)}</Descriptions.Item>
              <Descriptions.Item label="响应">
                {ev.family.respondedAt ? (
                  <Space direction="vertical" size={2}>
                    <Tag color={takenOver ? 'orange' : 'green'}>
                      {fmtTime(ev.family.respondedAt)} · {FAMILY_RESP_LABEL[ev.family.response!]}
                    </Tag>
                    {takenOver && <Text type="warning" style={{ fontSize: 12 }}>家属在社区接管后才响应，社区已采取的动作不受影响并继续推进</Text>}
                  </Space>
                ) : ev.family.timedOut ? (
                  <Tag color="red">5分钟超时未响应，社区已接管</Tag>
                ) : (
                  <Tag color="gold">等待响应中…</Tag>
                )}
              </Descriptions.Item>
              {ev.family.note && <Descriptions.Item label="家属留言">{ev.family.note}</Descriptions.Item>}
            </Descriptions>
          </Card>
        </Col>

        {/* 中：处置流程 + 全程记录 */}
        <Col xs={24} lg={9}>
          <PlanSteps event={ev} />
          <EventTimeline event={ev} />
        </Col>

        {/* 右：操作面板 */}
        <Col xs={24} lg={8}>
          {!closed && (
            <Card size="small" title="社区处置操作" style={{ marginBottom: 12 }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                {/* 1. 电话核实 */}
                <Text strong style={{ fontSize: 13 }}>
                  ① 电话核实老人
                </Text>
                <Space wrap>
                  <Button
                    icon={<PhoneOutlined />}
                    onClick={() => {
                      store.recordPhoneAttempt(ev.id, 'answered', phoneNote)
                      setPhoneNote('')
                    }}
                  >
                    电话已接听
                  </Button>
                  <Button
                    danger
                    icon={<PhoneOutlined />}
                    onClick={() => {
                      store.recordPhoneAttempt(ev.id, 'no_answer', phoneNote)
                      setPhoneNote('')
                    }}
                  >
                    电话无人接
                  </Button>
                </Space>
                <Input.TextArea
                  rows={1}
                  placeholder="电话核实备注（可选）"
                  value={phoneNote}
                  onChange={(e) => setPhoneNote(e.target.value)}
                />
                {takenOver && !dv && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {phoneTriedNoAnswer ? '电话核实无果，可立即派网格员上门' : '接管后需先电话核实；无人接听后方可派单上门'}
                  </Text>
                )}

                {/* 2. 派单上门 */}
                {!dv && ev.status !== 'medical' && (
                  <Button
                    type="primary"
                    block
                    disabled={takenOver && !phoneTriedNoAnswer}
                    onClick={() => store.dispatchVisit(ev.id, worker.name)}
                  >
                    派单上门（就近：{worker.name}，约{worker.distanceMin}分钟）
                  </Button>
                )}

                {/* 3. 到达记录 */}
                {dv && !dv.arrivedAt && (
                  <Button block type="primary" onClick={() => setArrivalModal(true)}>
                    记录到达（{dv.assignee}）
                  </Button>
                )}

                {dv?.arrivedAt && (
                  <Card size="small" type="inner" title="网格员到达记录" style={{ width: '100%' }}>
                    <Descriptions column={1} size="small">
                      <Descriptions.Item label="到达时间">{fmtTime(dv.arrivedAt)}</Descriptions.Item>
                      <Descriptions.Item label="是否联系物业">
                        {dv.contactedProperty ? <Tag color="blue">已联系物业</Tag> : <Tag>未联系</Tag>}
                      </Descriptions.Item>
                      <Descriptions.Item label="是否需要急救">
                        {dv.needEmergency ? <Tag color="red">需要急救（120）</Tag> : <Tag color="green">暂不需要</Tag>}
                      </Descriptions.Item>
                    </Descriptions>
                  </Card>
                )}

                {/* 4. 入户初步结果（无人开门 / 平安 / 需医疗） */}
                {dv?.arrivedAt && !dv.result && (
                  <Button type="primary" block onClick={() => setVisitResultModal(true)}>
                    记录入户初步结果
                  </Button>
                )}
                {dv?.result === 'no_answer' && !dv.propertyInvolved && (
                  <Space wrap>
                    <Button onClick={() => store.involveProperty(ev.id, false)}>联动物业开门</Button>
                    <Button onClick={() => store.involveProperty(ev.id, true)}>使用托管钥匙入户</Button>
                  </Space>
                )}
                {dv?.result === 'no_answer' && dv.propertyInvolved && !report && (
                  <Button type="primary" block onClick={() => setVisitResultModal(true)}>
                    入户后记录初步结果
                  </Button>
                )}
                {dv?.arrivedAt && dv.result && dv.result !== 'no_answer' && !report && (
                  <Button type="primary" block onClick={() => setReportModal(true)}>
                    网格员补充上门结束报告
                  </Button>
                )}

                {dv?.needEmergency && !ev.medical?.called120 && (
                  <Button danger block onClick={() => store.call120(ev.id, 'community')}>
                    呼叫120急救
                  </Button>
                )}
                {!dv?.needEmergency && !ev.medical?.called120 && !closed && ev.status !== 'follow_up' && (
                  <Button danger block onClick={() => store.call120(ev.id, 'community')}>
                    呼叫120急救（兜底）
                  </Button>
                )}
                {ev.medical?.called120 && !ev.medical.outcome && (
                  <Button type="primary" block onClick={() => setMedicalModal(true)}>
                    记录就医结果
                  </Button>
                )}

                {/* 5. 上门结束报告摘要 */}
                {report && (
                  <Card size="small" type="inner" title="上门结束报告" style={{ width: '100%' }}>
                    <Descriptions column={1} size="small">
                      <Descriptions.Item label="现场结果">{report.sceneResult}</Descriptions.Item>
                      <Descriptions.Item label="老人状态">
                        <Tag color={report.elderStatus === 'good' ? 'green' : report.elderStatus === 'minor' ? 'orange' : 'red'}>
                          {ELDER_STATUS_LABEL[report.elderStatus]}
                        </Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="是否送医">{report.sentToHospital ? <Tag color="red">已送医</Tag> : <Tag color="green">未送医</Tag>}</Descriptions.Item>
                      <Descriptions.Item label="后续复访">
                        {report.needRevisit ? <Tag color="orange">需要复访：{report.revisitNote ?? '待安排'}</Tag> : <Tag>无需复访</Tag>}
                      </Descriptions.Item>
                      <Descriptions.Item label="提交">
                        {fmtTime(report.reportedAt)} · {report.reportedBy}
                      </Descriptions.Item>
                    </Descriptions>
                  </Card>
                )}

                {/* 6. 回访 / 结案 */}
                {ev.status === 'follow_up' && !ev.followUp && (
                  <Button block onClick={() => setFollowUpModal(true)}>
                    记录回访
                  </Button>
                )}
                {ev.status === 'follow_up' && ev.followUp && blockers.length > 0 && (
                  <Alert type="error" showIcon message="暂不允许结案" description={blockers.join('；')} />
                )}
                {ev.status === 'follow_up' && ev.followUp && (
                  <Button
                    type="primary"
                    block
                    icon={<SafetyOutlined />}
                    disabled={blockers.length > 0}
                    onClick={() => setCloseModal(true)}
                  >
                    {dv && !report ? '网格员补充上门结束报告后才可结案' : '结案并生成复盘'}
                  </Button>
                )}
                {ev.status !== 'follow_up' && dv && !report && !closed && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    上门结束后须由网格员补充现场结果、老人状态、是否送医与是否复访，事件才允许关闭。
                  </Text>
                )}
              </Space>
            </Card>
          )}

          {!closed && !ev.family.respondedAt && (
            <Card size="small" title="家属端操作模拟（演示用）" style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                家属账号（family/123456）登录后在其门户执行同样操作；此处为社区端演示入口。
              </Text>
              <Input.TextArea
                rows={2}
                style={{ marginTop: 8 }}
                placeholder="家属留言（可选）"
                value={familyNote}
                onChange={(e) => setFamilyNote(e.target.value)}
              />
              <Space wrap style={{ marginTop: 8 }}>
                <Button onClick={() => familyAct('false_alarm')}>确认误报</Button>
                <Button onClick={() => familyAct('request_call')}>请求电话核实</Button>
                <Button type="primary" onClick={() => familyAct('request_visit')}>
                  要求上门
                </Button>
                <Button danger onClick={() => familyAct('called_120')}>
                  直接拨打120
                </Button>
              </Space>
            </Card>
          )}

          {ev.closure && (
            <Card size="small" title="结案复盘报告" style={{ marginBottom: 12 }}>
              <Row gutter={8} style={{ marginBottom: 8 }}>
                <Col span={8}>
                  <Statistic title="家属响应时长" value={fmtMinutes(ev.closure.familyResponseMinutes)} valueStyle={{ fontSize: 16 }} />
                </Col>
                <Col span={8}>
                  <Statistic title="社区处置时效" value={fmtMinutes(ev.closure.communityHandleMinutes)} valueStyle={{ fontSize: 16 }} />
                </Col>
                <Col span={8}>
                  <Statistic title="事件分类" value={CLOSURE_LABEL[ev.closure.category]} valueStyle={{ fontSize: 16 }} />
                </Col>
              </Row>
              <Descriptions column={1} size="small" bordered>
                {ev.closure.falseReason && <Descriptions.Item label="误报原因">{ev.closure.falseReason}</Descriptions.Item>}
                <Descriptions.Item label="设备调整建议">{ev.closure.deviceSuggestion}</Descriptions.Item>
                <Descriptions.Item label="复盘总结">{ev.closure.summary}</Descriptions.Item>
                <Descriptions.Item label="结案">
                  {fmtTime(ev.closure.closedAt)} · {ev.closure.closedBy}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          )}
        </Col>
      </Row>

      {/* 网格员到达：到达时间 + 是否联系物业 + 是否需要急救 */}
      <Modal
        title="网格员到达现场"
        open={arrivalModal}
        onCancel={() => setArrivalModal(false)}
        onOk={() => {
          store.recordArrival(ev.id, contactedProperty, needEmergency)
          setArrivalModal(false)
          setContactedProperty(false)
          setNeedEmergency(false)
          message.success('到达时间与现场处置动作已记录')
        }}
      >
        <Text type="secondary">到达时间：{fmtTime(store.now())}（自动记录）</Text>
        <div style={{ marginTop: 12 }}>
          <Checkbox checked={contactedProperty} onChange={(e) => setContactedProperty(e.target.checked)}>
            已联系物业（值班到场/远程开门/待命）
          </Checkbox>
        </div>
        <div style={{ marginTop: 8 }}>
          <Checkbox checked={needEmergency} onChange={(e) => setNeedEmergency(e.target.checked)}>
            现场判断需要急救（立即呼叫120）
          </Checkbox>
        </div>
      </Modal>

      {/* 入户初步结果 */}
      <Modal
        title="记录入户初步结果"
        open={visitResultModal}
        onCancel={() => setVisitResultModal(false)}
        onOk={() => {
          store.recordVisitResult(ev.id, visitResult, visitNote)
          setVisitResultModal(false)
          setVisitNote('')
        }}
      >
        <Radio.Group
          value={visitResult}
          onChange={(e) => setVisitResult(e.target.value)}
          options={[
            { value: 'ok', label: '老人在场（待补充结束报告）' },
            { value: 'no_answer', label: '无人开门' },
            { value: 'need_medical', label: '需医疗处置' },
          ]}
        />
        <Input.TextArea rows={2} style={{ marginTop: 12 }} placeholder="现场情况备注" value={visitNote} onChange={(e) => setVisitNote(e.target.value)} />
      </Modal>

      {/* 上门结束报告（结案必填） */}
      <Modal
        title="网格员上门结束报告"
        open={reportModal}
        width={560}
        onCancel={() => setReportModal(false)}
        onOk={() =>
          reportForm.validateFields().then((v) => {
            store.submitVisitReport(ev.id, {
              sceneResult: v.sceneResult,
              elderStatus: v.elderStatus,
              sentToHospital: v.sentToHospital,
              needRevisit: v.needRevisit,
              revisitNote: v.revisitNote,
              note: v.note,
            })
            setReportModal(false)
            reportForm.resetFields()
            message.success('上门结束报告已提交')
          })
        }
      >
        <Form
          form={reportForm}
          layout="vertical"
          initialValues={{ elderStatus: 'good', sentToHospital: false, needRevisit: false }}
        >
          <Form.Item name="sceneResult" label="现场结果" rules={[{ required: true, message: '请描述现场处置结果' }]}>
            <Input.TextArea rows={3} placeholder="如：老人倒在浴室地面，右髋疼痛无法站立，意识清楚，已协助平卧保暖等待120" />
          </Form.Item>
          <Form.Item name="elderStatus" label="老人状态" rules={[{ required: true }]}>
            <Radio.Group
              options={(Object.keys(ELDER_STATUS_LABEL) as DoorVisitReport['elderStatus'][]).map((k) => ({
                value: k,
                label: ELDER_STATUS_LABEL[k],
              }))}
            />
          </Form.Item>
          <Form.Item name="sentToHospital" label="是否送医" valuePropName="checked">
            <Checkbox>已送医/需送医{reportStatus === 'serious' ? '（老人状态为伤情较重，建议勾选）' : ''}</Checkbox>
          </Form.Item>
          <Form.Item name="needRevisit" label="是否需要后续复访" valuePropName="checked">
            <Checkbox>需要后续复访</Checkbox>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(p, c) => p.needRevisit !== c.needRevisit}>
            {({ getFieldValue }) =>
              getFieldValue('needRevisit') ? (
                <Form.Item name="revisitNote" label="复访安排" rules={[{ required: true, message: '请填写复访安排' }]}>
                  <Input placeholder="如：明日上午上门复查髋部情况并电话告知女儿" />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item name="note" label="其他备注">
            <Input.TextArea rows={2} placeholder="物业配合、钥匙使用、家属沟通等（可选）" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 就医结果 */}
      <Modal
        title="记录就医结果"
        open={medicalModal}
        onCancel={() => setMedicalModal(false)}
        onOk={() =>
          medicalForm.validateFields().then((v) => {
            store.recordMedical(ev.id, v.hospital, v.outcome)
            setMedicalModal(false)
          })
        }
      >
        <Form form={medicalForm} layout="vertical">
          <Form.Item name="hospital" label="送医医院" rules={[{ required: true, message: '请填写医院' }]}>
            <Input placeholder="如：区人民医院心内科" />
          </Form.Item>
          <Form.Item name="outcome" label="诊断与处置结果" rules={[{ required: true, message: '请填写结果' }]}>
            <Input.TextArea rows={2} placeholder="如：房颤发作，急诊处理后留观" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 回访 */}
      <Modal
        title="记录回访"
        open={followUpModal}
        onCancel={() => setFollowUpModal(false)}
        onOk={() => {
          store.recordFollowUp(ev.id, followUpNote || '电话回访，老人状态平稳')
          setFollowUpModal(false)
          setFollowUpNote('')
        }}
      >
        <Input.TextArea rows={3} placeholder="回访情况（老人状态、家属反馈、设备检查）" value={followUpNote} onChange={(e) => setFollowUpNote(e.target.value)} />
      </Modal>

      {/* 结案 */}
      <Modal
        title="结案并生成复盘报告"
        open={closeModal}
        onCancel={() => setCloseModal(false)}
        onOk={doClose}
      >
        <Form form={closeForm} layout="vertical" initialValues={{ category: 'device_false' as ClosureCategory }}>
          <Form.Item name="category" label="事件分类（区分设备误报 / 照护缺口 / 真实风险）" rules={[{ required: true }]}>
            <Radio.Group
              options={Object.entries(CLOSURE_LABEL).map(([v, l]) => ({ value: v, label: l }))}
              optionType="button"
              buttonStyle="solid"
            />
          </Form.Item>
          {closeCategory === 'device_false' && (
            <Form.Item name="falseReason" label="误报原因" rules={[{ required: true, message: '请选择误报原因' }]}>
              <Select options={FALSE_REASONS.map((r) => ({ value: r, label: r }))} />
            </Form.Item>
          )}
          <Form.Item name="summary" label="复盘总结" rules={[{ required: true, message: '请填写复盘总结' }]}>
            <Input.TextArea rows={3} placeholder="处置经过、响应情况、后续注意事项" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default EventDetailPage
