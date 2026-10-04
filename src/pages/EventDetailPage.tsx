import React, { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
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
  Tooltip,
  Typography,
  message,
} from 'antd'
import { ArrowLeftOutlined, PhoneOutlined, SafetyOutlined } from '@ant-design/icons'
import { useStore, GRID_WORKERS, nearestWorker } from '../store/useStore'
import { CLOSURE_LABEL, ClosureCategory, ESCALATION_LABEL } from '../types'
import { ELDER_STATUS_OPTIONS, FALSE_REASONS, SITE_RESULT_OPTIONS, canCloseEvent, canDispatchVisit } from '../store/workflow'
import { AlertTypeTag, SeverityTag, StatusTag, fmtMinutes, fmtTime } from '../components/common'
import ElderInfoCard from '../components/ElderInfoCard'
import PlanSteps from '../components/PlanSteps'
import EventTimeline from '../components/EventTimeline'
import DutyEscalationPanel from '../components/DutyEscalationPanel'

const { Text, Title } = Typography

const EventDetailPage: React.FC = () => {
  const { id } = useParams()
  const nav = useNavigate()
  const store = useStore()
  const ev = store.events.find((e) => e.id === id)
  const elder = store.elders.find((e) => e.id === ev?.elderId)
  const [familyNote, setFamilyNote] = useState('')
  const [phoneNote, setPhoneNote] = useState('')
  const [visitModal, setVisitModal] = useState(false)
  const [visitResult, setVisitResult] = useState<'ok' | 'no_answer' | 'need_medical'>('ok')
  const [visitNote, setVisitNote] = useState('')
  const [arrivalModal, setArrivalModal] = useState(false)
  const [arrivalForm] = Form.useForm()
  const [siteReportModal, setSiteReportModal] = useState(false)
  const [siteReportForm] = Form.useForm()
  const sentToHospital = Form.useWatch('sentToHospital', siteReportForm)
  const [medicalModal, setMedicalModal] = useState(false)
  const [medicalForm] = Form.useForm()
  const [followUpModal, setFollowUpModal] = useState(false)
  const [followUpNote, setFollowUpNote] = useState('')
  const [closeModal, setCloseModal] = useState(false)
  const [closeForm] = Form.useForm()
  const closeCategory = Form.useWatch('category', closeForm)

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
  const dispatchable = canDispatchVisit(ev)
  const closable = canCloseEvent(ev)
  const needMedicalRecord = (ev.medical?.called120 || ev.doorVisit?.siteReport?.sentToHospital) && !ev.medical?.outcome

  const familyAct = (response: 'false_alarm' | 'request_call' | 'request_visit' | 'called_120') => {
    store.familyRespond(ev.id, response, familyNote)
    setFamilyNote('')
    message.success('家属操作已记录')
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
                  <Tag color="orange">{ESCALATION_LABEL[e.kind]}</Tag>
                  {fmtTime(e.at)} · {e.note}
                </Text>
              ))}
            </Space>
          }
        />
      )}

      {ev.dutyEscalation && <DutyEscalationPanel event={ev} elder={elder} />}

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
                  <Tag color="green">
                    {fmtTime(ev.family.respondedAt)} ·{' '}
                    {{ false_alarm: '确认误报', request_call: '请求电话核实', request_visit: '要求上门', called_120: '已拨打120' }[ev.family.response!]}
                  </Tag>
                ) : ev.family.timedOut ? (
                  <Tag color="red">超时未响应，社区已接管</Tag>
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
                <Space wrap>
                  <Button
                    icon={<PhoneOutlined />}
                    onClick={() => {
                      store.recordPhoneAttempt(ev.id, 'answered', phoneNote)
                      setPhoneNote('')
                    }}
                  >
                    电话核实：已接听
                  </Button>
                  <Button
                    danger
                    icon={<PhoneOutlined />}
                    onClick={() => {
                      store.recordPhoneAttempt(ev.id, 'no_answer', phoneNote)
                      setPhoneNote('')
                    }}
                  >
                    电话核实：无人接
                  </Button>
                </Space>
                <Input.TextArea
                  rows={1}
                  placeholder="电话核实备注（可选）"
                  value={phoneNote}
                  onChange={(e) => setPhoneNote(e.target.value)}
                />
                {!ev.doorVisit && ev.status !== 'medical' && ev.status !== 'follow_up' && (
                  <>
                    <Tooltip title={!dispatchable ? '值班员升级事件：需先电话核实无果（至少 1 次无人接听）后方可派单' : ''}>
                      <Button type="primary" block disabled={!dispatchable} onClick={() => store.dispatchVisit(ev.id, worker.name)}>
                        派单上门（就近：{worker.name}，约{worker.distanceMin}分钟）
                      </Button>
                    </Tooltip>
                    {!dispatchable && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        请先进行电话核实，确认无果（无人接听）后再派网格员上门
                      </Text>
                    )}
                  </>
                )}
                {ev.doorVisit && !ev.doorVisit.arrivedAt && (
                  <Button type="primary" block onClick={() => setArrivalModal(true)}>
                    到达登记（{ev.doorVisit.assignee}）：到达时间 / 物业 / 急救
                  </Button>
                )}
                {ev.doorVisit && ev.doorVisit.arrivedAt && !ev.doorVisit.result && (
                  <Button type="primary" block onClick={() => setVisitModal(true)}>
                    记录上门结果
                  </Button>
                )}
                {ev.doorVisit?.result === 'no_answer' && !ev.doorVisit.propertyInvolved && (
                  <Space wrap>
                    <Button onClick={() => store.involveProperty(ev.id, false)}>联动物业开门</Button>
                    <Button onClick={() => store.involveProperty(ev.id, true)}>使用托管钥匙入户</Button>
                  </Space>
                )}
                {ev.doorVisit?.propertyInvolved && !ev.doorVisit.result?.match(/ok|need_medical/) && (
                  <Button type="primary" block onClick={() => setVisitModal(true)}>
                    入户后记录结果
                  </Button>
                )}
                {!ev.medical?.called120 && ev.status !== 'follow_up' && (
                  <Button danger block onClick={() => store.call120(ev.id, 'community')}>
                    呼叫120急救
                  </Button>
                )}
                {needMedicalRecord && (
                  <Button type="primary" block onClick={() => setMedicalModal(true)}>
                    记录就医结果
                  </Button>
                )}
                {ev.doorVisit && !ev.doorVisit.siteReport && (ev.doorVisit.result || ev.status === 'follow_up') && (
                  <Button type="primary" block onClick={() => setSiteReportModal(true)}>
                    补充上门现场报告（结案前必填）
                  </Button>
                )}
                {ev.status === 'follow_up' && !ev.followUp && (
                  <Button block onClick={() => setFollowUpModal(true)}>
                    记录回访
                  </Button>
                )}
                {ev.status === 'follow_up' && ev.followUp && (
                  <>
                    <Tooltip title={!closable ? '有上门记录的事件需先由网格员补充现场报告（现场结果/老人状态/是否送医/是否复访）' : ''}>
                      <Button type="primary" block icon={<SafetyOutlined />} disabled={!closable} onClick={() => setCloseModal(true)}>
                        结案并生成复盘
                      </Button>
                    </Tooltip>
                    {!closable && (
                      <Text type="danger" style={{ fontSize: 12 }}>
                        请先补充上门现场报告，事件才允许关闭
                      </Text>
                    )}
                  </>
                )}
              </Space>
            </Card>
          )}

          {ev.doorVisit && (
            <Card size="small" title="上门处置记录" style={{ marginBottom: 12 }}>
              <Descriptions column={1} size="small" bordered
                items={[
                  { key: 'dispatch', label: '派单', children: `${fmtTime(ev.doorVisit.dispatchedAt)} · ${ev.doorVisit.assignee}` },
                  ...(ev.doorVisit.arrivedAt
                    ? [
                        {
                          key: 'arrive',
                          label: '到达登记',
                          children: (
                            <Space size={4} wrap>
                              <Text style={{ fontSize: 12 }}>{fmtTime(ev.doorVisit.arrivedAt)}</Text>
                              <Tag color={ev.doorVisit.propertyContacted ? 'geekblue' : 'default'}>
                                {ev.doorVisit.propertyContacted ? '已联系物业' : '未联系物业'}
                              </Tag>
                              <Tag color={ev.doorVisit.firstAidNeeded ? 'red' : 'default'}>
                                {ev.doorVisit.firstAidNeeded ? '需要急救' : '无需急救'}
                              </Tag>
                            </Space>
                          ),
                        },
                      ]
                    : []),
                  ...(ev.doorVisit.result
                    ? [
                        {
                          key: 'result',
                          label: '上门结果',
                          children: { ok: '老人平安', no_answer: '无人开门', need_medical: '需医疗处置' }[ev.doorVisit.result],
                        },
                      ]
                    : []),
                  ...(ev.doorVisit.propertyInvolved
                    ? [{ key: 'prop', label: '物业联动', children: ev.doorVisit.usedKeyCustody ? '物业协助 + 使用托管钥匙入户' : '物业协助开门' }]
                    : []),
                  ...(ev.doorVisit.siteReport
                    ? [
                        {
                          key: 'site',
                          label: '现场报告',
                          children: (
                            <Space direction="vertical" size={2}>
                              <Text style={{ fontSize: 12 }}>现场结果：{ev.doorVisit.siteReport.result}</Text>
                              <Text style={{ fontSize: 12 }}>老人状态：{ev.doorVisit.siteReport.elderStatus}</Text>
                              <Space size={4}>
                                <Tag color={ev.doorVisit.siteReport.sentToHospital ? 'red' : 'default'}>
                                  {ev.doorVisit.siteReport.sentToHospital ? '已送医' : '未送医'}
                                </Tag>
                                <Tag color={ev.doorVisit.siteReport.needRevisit ? 'orange' : 'default'}>
                                  {ev.doorVisit.siteReport.needRevisit ? '需后续复访' : '无需复访'}
                                </Tag>
                              </Space>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {fmtTime(ev.doorVisit.siteReport.at)} · {ev.doorVisit.siteReport.by}
                                {ev.doorVisit.siteReport.note ? ` · ${ev.doorVisit.siteReport.note}` : ''}
                              </Text>
                            </Space>
                          ),
                        },
                      ]
                    : [
                        {
                          key: 'site-pending',
                          label: '现场报告',
                          children: <Tag color="gold">待网格员补充（结案前必填）</Tag>,
                        },
                      ]),
                ]}
              />
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
                {ev.doorVisit?.siteReport && (
                  <Descriptions.Item label="上门现场报告">
                    {ev.doorVisit.siteReport.result}；老人状态：{ev.doorVisit.siteReport.elderStatus}；
                    {ev.doorVisit.siteReport.sentToHospital ? '已送医' : '未送医'}；
                    {ev.doorVisit.siteReport.needRevisit ? '需后续复访' : '无需复访'}（{ev.doorVisit.siteReport.by}）
                  </Descriptions.Item>
                )}
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

      {/* 到达登记：到达时间自动记录，同时登记是否联系物业、是否需要急救 */}
      <Modal
        title="到达登记"
        open={arrivalModal}
        onCancel={() => setArrivalModal(false)}
        onOk={() =>
          arrivalForm.validateFields().then((v) => {
            store.recordArrival(ev.id, { propertyContacted: v.propertyContacted, firstAidNeeded: v.firstAidNeeded, note: v.note })
            setArrivalModal(false)
            arrivalForm.resetFields()
            message.success(`已记录到达时间${v.firstAidNeeded ? '，现场需要急救，请立即联动120' : ''}`)
          })
        }
      >
        <Form form={arrivalForm} layout="vertical" initialValues={{ propertyContacted: false, firstAidNeeded: false }}>
          <Form.Item label="到达时间">
            <Text>提交时自动记录当前时间（{ev.doorVisit?.assignee}）</Text>
          </Form.Item>
          <Form.Item name="propertyContacted" label="是否已联系物业" rules={[{ required: true }]}>
            <Radio.Group
              options={[
                { value: true, label: '是（已联系物业值班）' },
                { value: false, label: '否' },
              ]}
              optionType="button"
              buttonStyle="solid"
            />
          </Form.Item>
          <Form.Item name="firstAidNeeded" label="现场是否需要急救" rules={[{ required: true }]}>
            <Radio.Group
              options={[
                { value: true, label: '需要急救' },
                { value: false, label: '暂不需要' },
              ]}
              optionType="button"
              buttonStyle="solid"
            />
          </Form.Item>
          <Form.Item name="note" label="备注（可选）">
            <Input.TextArea rows={2} placeholder="如：敲门无人应答，物业正在赶来" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 上门现场报告：结案前必填 */}
      <Modal
        title="补充上门现场报告"
        open={siteReportModal}
        onCancel={() => setSiteReportModal(false)}
        onOk={() =>
          siteReportForm.validateFields().then((v) => {
            store.recordSiteReport(ev.id, {
              result: v.result,
              elderStatus: v.elderStatus,
              sentToHospital: v.sentToHospital,
              needRevisit: v.needRevisit,
              note: v.note,
            })
            setSiteReportModal(false)
            siteReportForm.resetFields()
            message.success(v.sentToHospital ? '现场报告已提交，老人已送医，请补记就医结果' : '现场报告已提交，事件可进入结案流程')
          })
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="上门结束后由网格员补充，事件关闭前必填"
        />
        <Form form={siteReportForm} layout="vertical" initialValues={{ sentToHospital: false, needRevisit: false }}>
          <Form.Item name="result" label="现场结果" rules={[{ required: true, message: '请选择现场结果' }]}>
            <Select options={SITE_RESULT_OPTIONS.map((r) => ({ value: r, label: r }))} placeholder="选择现场处置结果" />
          </Form.Item>
          <Form.Item name="elderStatus" label="老人状态" rules={[{ required: true, message: '请选择老人状态' }]}>
            <Radio.Group options={ELDER_STATUS_OPTIONS.map((s) => ({ value: s, label: s }))} optionType="button" buttonStyle="solid" />
          </Form.Item>
          <Form.Item name="sentToHospital" label="是否送医" rules={[{ required: true }]}>
            <Radio.Group
              options={[
                { value: true, label: '已送医' },
                { value: false, label: '未送医' },
              ]}
              optionType="button"
              buttonStyle="solid"
            />
          </Form.Item>
          {sentToHospital && (
            <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="送医事件提交后需补记送医医院与诊断结果" />
          )}
          <Form.Item name="needRevisit" label="是否需要后续复访" rules={[{ required: true }]}>
            <Radio.Group
              options={[
                { value: true, label: '需要复访' },
                { value: false, label: '无需复访' },
              ]}
              optionType="button"
              buttonStyle="solid"
            />
          </Form.Item>
          <Form.Item name="note" label="补充说明（可选）">
            <Input.TextArea rows={2} placeholder="如：建议家属更换浴室防滑垫" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 上门结果 */}
      <Modal
        title="记录上门结果"
        open={visitModal}
        onCancel={() => setVisitModal(false)}
        onOk={() => {
          store.recordVisitResult(ev.id, visitResult, visitNote)
          setVisitModal(false)
          setVisitNote('')
        }}
      >
        <Radio.Group
          value={visitResult}
          onChange={(e) => setVisitResult(e.target.value)}
          options={[
            { value: 'ok', label: '老人平安' },
            { value: 'no_answer', label: '无人开门' },
            { value: 'need_medical', label: '需医疗处置' },
          ]}
        />
        <Input.TextArea rows={2} style={{ marginTop: 12 }} placeholder="现场情况备注" value={visitNote} onChange={(e) => setVisitNote(e.target.value)} />
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
        onOk={() =>
          closeForm.validateFields().then((v) => {
            store.closeEvent(ev.id, v.category, v.falseReason, v.summary)
            setCloseModal(false)
            message.success('已结案，复盘报告已生成并沉淀至照护画像')
          })
        }
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
