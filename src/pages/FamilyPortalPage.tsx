import React, { useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Descriptions, Empty, Input, Layout, Row, Space, Tag, Typography, message } from 'antd'
import {
  CheckCircleOutlined,
  HomeOutlined,
  LogoutOutlined,
  MedicineBoxOutlined,
  PhoneOutlined,
  SafetyOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useStore } from '../store/useStore'
import { AlertEvent, ELDER_STATUS_LABEL } from '../types'
import { AlertTypeTag, SeverityTag, StatusTag, fmtTime } from '../components/common'
import ElderInfoCard from '../components/ElderInfoCard'
import EventTimeline from '../components/EventTimeline'

const { Header, Content } = Layout
const { Title, Text } = Typography

/** 社区已采取动作摘要：接管后家属随时可查看值班员/网格员的处置进展 */
const CommunityActions: React.FC<{ ev: AlertEvent }> = ({ ev }) => {
  const dv = ev.doorVisit
  const takeover = ev.escalations.find((e) => e.kind === 'community_takeover')
  const noAnswer = ev.phoneAttempts.filter((a) => a.result === 'no_answer').length
  const answered = ev.phoneAttempts.some((a) => a.result === 'answered')
  const items: { label: string; content: React.ReactNode }[] = []

  if (takeover) {
    items.push({ label: '自动升级', content: <Tag color="red">社区值班员已于 {fmtTime(takeover.at)} 接管（家属5分钟内未确认）</Tag> })
  }
  if (ev.phoneAttempts.length > 0) {
    items.push({
      label: '电话核实',
      content: (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>
            共拨打 {ev.phoneAttempts.length} 次：{noAnswer > 0 && <Tag color="red">{noAnswer} 次无人接</Tag>}
            {answered && <Tag color="green">已接听</Tag>}
          </Text>
          {ev.phoneAttempts.map((a, i) => (
            <Text key={i} type="secondary" style={{ fontSize: 12 }}>
              {fmtTime(a.at)} {a.by} · {a.result === 'answered' ? '已接听' : '无人接听'}
              {a.note ? ` · ${a.note}` : ''}
            </Text>
          ))}
        </Space>
      ),
    })
  }
  if (dv) {
    items.push({ label: '派单上门', content: <Text style={{ fontSize: 12 }}>{fmtTime(dv.dispatchedAt)} 已派网格员 {dv.assignee} 上门</Text> })
  }
  if (dv?.arrivedAt) {
    items.push({
      label: '到达现场',
      content: (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>{fmtTime(dv.arrivedAt)} {dv.assignee} 已到达老人家门口</Text>
          <Space size={4} wrap>
            <Tag color={dv.contactedProperty ? 'blue' : 'default'}>{dv.contactedProperty ? '已联系物业' : '未联系物业'}</Tag>
            <Tag color={dv.needEmergency ? 'red' : 'green'}>{dv.needEmergency ? '现场判断需要急救' : '暂不需要急救'}</Tag>
          </Space>
        </Space>
      ),
    })
  }
  if (dv?.propertyInvolved) {
    items.push({
      label: '物业/钥匙',
      content: <Text style={{ fontSize: 12 }}>{dv.usedKeyCustody ? '物业已到场并使用社区托管钥匙入户' : '物业已到场协助开门'}</Text>,
    })
  }
  if (dv?.report) {
    items.push({
      label: '上门结果',
      content: (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>{dv.report.sceneResult}</Text>
          <Space size={4} wrap>
            <Tag color={dv.report.elderStatus === 'good' ? 'green' : dv.report.elderStatus === 'minor' ? 'orange' : 'red'}>
              老人{ELDER_STATUS_LABEL[dv.report.elderStatus]}
            </Tag>
            <Tag color={dv.report.sentToHospital ? 'red' : 'green'}>{dv.report.sentToHospital ? '已送医' : '未送医'}</Tag>
            <Tag color={dv.report.needRevisit ? 'orange' : 'default'}>{dv.report.needRevisit ? '需要后续复访' : '无需复访'}</Tag>
          </Space>
        </Space>
      ),
    })
  }
  if (ev.medical?.called120) {
    items.push({
      label: '120急救',
      content: (
        <Text style={{ fontSize: 12 }}>
          已呼叫120{ev.medical.at ? `（${fmtTime(ev.medical.at)}）` : ''}
          {ev.medical.hospital ? ` · 送医：${ev.medical.hospital}` : ''}
          {ev.medical.outcome ? ` · ${ev.medical.outcome}` : ' · 等待就医结果'}
        </Text>
      ),
    })
  }
  if (ev.followUp) {
    items.push({ label: '回访', content: <Text style={{ fontSize: 12 }}>{fmtTime(ev.followUp.at)} {ev.followUp.by}：{ev.followUp.note}</Text> })
  }

  if (items.length === 0) return null
  return (
    <Card
      size="small"
      type="inner"
      style={{ marginTop: 12 }}
      title={
        <Space>
          <SafetyOutlined style={{ color: '#1677ff' }} />
          <Text strong>社区已采取的动作</Text>
        </Space>
      }
    >
      <Descriptions column={1} size="small">
        {items.map((it) => (
          <Descriptions.Item key={it.label} label={it.label}>
            {it.content}
          </Descriptions.Item>
        ))}
      </Descriptions>
    </Card>
  )
}

/** 家属端门户：确认误报 / 请求电话核实 / 要求上门 / 直接联系急救；接管后可查看社区已采取动作 */
const FamilyPortalPage: React.FC = () => {
  const session = useStore((s) => s.session)!
  const logout = useStore((s) => s.logout)
  const elders = useStore((s) => s.elders)
  const events = useStore((s) => s.events)
  const familyRespond = useStore((s) => s.familyRespond)
  const [notes, setNotes] = useState<Record<string, string>>({})

  const elder = elders.find((e) => e.id === session.elderId)
  const myEvents = events.filter((e) => e.elderId === session.elderId)
  const active = myEvents.filter((e) => e.status !== 'closed')
  const history = myEvents.filter((e) => e.status === 'closed')

  const takeoverIds = useMemo(
    () => new Set(active.filter((e) => e.family.timedOut || e.escalations.some((x) => x.kind === 'community_takeover')).map((e) => e.id)),
    [active],
  )

  if (!elder) return null

  const act = (eventId: string, response: 'false_alarm' | 'request_call' | 'request_visit' | 'called_120') => {
    familyRespond(eventId, response, notes[eventId] ?? '')
    message.success('您的操作已通知社区值班中心')
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px' }}>
        <Space>
          <SafetyOutlined style={{ fontSize: 20, color: '#1677ff' }} />
          <Title level={4} style={{ margin: 0 }}>
            家属端 · {elder.name}的告警确认
          </Title>
          <Tag color="green">{session.userName}</Tag>
        </Space>
        <Button size="small" icon={<LogoutOutlined />} onClick={logout}>
          退出
        </Button>
      </Header>
      <Content style={{ padding: 16, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        <Row gutter={12}>
          <Col xs={24} lg={9}>
            <ElderInfoCard elder={elder} communityView={false} />
          </Col>
          <Col xs={24} lg={15}>
            {active.length === 0 && (
              <Card size="small" style={{ marginBottom: 12 }}>
                <Empty description="当前没有待处理的告警，老人状态平稳" />
              </Card>
            )}
            {active.map((ev) => {
              const takenOver = takeoverIds.has(ev.id)
              return (
                <Card
                  key={ev.id}
                  size="small"
                  style={{ marginBottom: 12, borderColor: takenOver ? '#ff4d4f' : '#ff7875' }}
                  title={
                    <Space wrap>
                      <Tag color="red">{takenOver ? '社区处置中' : '新告警'}</Tag>
                      <AlertTypeTag v={ev.type} />
                      <SeverityTag v={ev.severity} />
                      <StatusTag v={ev.status} />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {fmtTime(ev.occurredAt)} · {ev.location}
                        {ev.isNight && ' · 夜间'}
                      </Text>
                    </Space>
                  }
                >
                  <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message={`手环上报${ev.location}发生告警，请您尽快确认老人情况`}
                    description="如确认为误报请点击「确认误报」；如需社区协助请选择电话核实或要求上门；紧急情况请直接拨打120。"
                  />

                  {takenOver && (
                    <Alert
                      type="warning"
                      showIcon
                      icon={<ThunderboltOutlined />}
                      style={{ marginBottom: 12 }}
                      message="您未在5分钟内确认，社区值班员已自动升级接管并上门处置"
                      description="夜间跌倒告警已由社区值班员接管：正在电话核实并安排网格员上门。您仍可在下方留言或操作，社区已采取的动作会实时显示在本页。"
                    />
                  )}

                  {!ev.family.respondedAt ? (
                    <>
                      <Input.TextArea
                        rows={2}
                        placeholder="给社区值班员留言（可选，如老人可能在洗澡/走亲戚等线索）"
                        style={{ marginBottom: 8 }}
                        value={notes[ev.id] ?? ''}
                        onChange={(e) => setNotes({ ...notes, [ev.id]: e.target.value })}
                      />
                      <Space wrap>
                        <Button icon={<CheckCircleOutlined />} onClick={() => act(ev.id, 'false_alarm')}>
                          确认误报
                        </Button>
                        <Button icon={<PhoneOutlined />} onClick={() => act(ev.id, 'request_call')}>
                          请求电话核实
                        </Button>
                        <Button type="primary" icon={<HomeOutlined />} onClick={() => act(ev.id, 'request_visit')}>
                          要求上门查看
                        </Button>
                        <Button danger icon={<MedicineBoxOutlined />} onClick={() => act(ev.id, 'called_120')}>
                          直接拨打120
                        </Button>
                      </Space>
                    </>
                  ) : (
                    <Alert
                      type="success"
                      showIcon
                      message={`您已于 ${fmtTime(ev.family.respondedAt)} 响应：${
                        { false_alarm: '确认误报', request_call: '请求电话核实', request_visit: '要求上门查看', called_120: '已拨打120' }[ev.family.response!]
                      }${takenOver ? '（社区已先行接管，您的响应已同步给处置人员）' : '，社区正在处置中'}`}
                    />
                  )}

                  {/* 家属随时可查看社区已采取的动作 */}
                  <CommunityActions ev={ev} />

                  <div style={{ marginTop: 12 }}>
                    <EventTimeline event={ev} />
                  </div>
                </Card>
              )
            })}

            {history.length > 0 && (
              <Card size="small" title="历史事件">
                {history.map((ev) => (
                  <Card
                    key={ev.id}
                    size="small"
                    type="inner"
                    style={{ marginBottom: 8 }}
                    title={
                      <Space>
                        <AlertTypeTag v={ev.type} />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {fmtTime(ev.occurredAt)}
                        </Text>
                        {ev.closure && (
                          <Tag color={ev.closure.category === 'real_risk' ? 'red' : ev.closure.category === 'care_gap' ? 'orange' : 'default'}>
                            {ev.closure.category === 'real_risk' ? '真实风险' : ev.closure.category === 'care_gap' ? '照护缺口' : '设备误报'}
                          </Tag>
                        )}
                      </Space>
                    }
                  >
                    {ev.closure && (
                      <Text style={{ fontSize: 12 }}>
                        {ev.closure.summary}
                        {ev.closure.falseReason && `（误报原因：${ev.closure.falseReason}）`}
                      </Text>
                    )}
                  </Card>
                ))}
              </Card>
            )}
          </Col>
        </Row>
      </Content>
    </Layout>
  )
}

export default FamilyPortalPage
