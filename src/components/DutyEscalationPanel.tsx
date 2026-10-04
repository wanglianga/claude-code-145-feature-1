import React from 'react'
import { Alert, Button, Card, Descriptions, Space, Tag, Typography } from 'antd'
import { ClockCircleOutlined, HomeOutlined, KeyOutlined, PhoneOutlined, UserSwitchOutlined } from '@ant-design/icons'
import { AlertEvent, Elder } from '../types'
import { useStore } from '../store/useStore'
import { fmtTime } from './common'

const { Text } = Typography

/**
 * 夜间跌倒无人响应升级面板（值班员视角）：
 * 家属 5 分钟内未确认自动升级，集中展示老人住址、最近活动、门禁备注、钥匙托管，
 * 值班员接管后电话核实，无果即可派网格员上门。
 */
const DutyEscalationPanel: React.FC<{ event: AlertEvent; elder: Elder }> = ({ event, elder }) => {
  const ackDuty = useStore((s) => s.ackDuty)
  const esc = event.dutyEscalation
  if (!esc) return null

  const noAnswerCount = event.phoneAttempts.filter((a) => a.result === 'no_answer').length
  const latestPlaces = [...elder.trajectory].sort((a, b) => b.at - a.at).slice(0, 3)

  return (
    <Card
      size="small"
      style={{ marginBottom: 12, borderColor: '#ff4d4f', borderWidth: 2 }}
      title={
        <Space>
          <UserSwitchOutlined style={{ color: '#ff4d4f' }} />
          <span>夜间跌倒无人响应 · 已升级社区值班员</span>
          <Tag color="red">自动升级</Tag>
        </Space>
      }
    >
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 12 }}
        message={`手环夜间触发跌倒告警，家属 5 分钟内未确认，系统已于 ${fmtTime(esc.escalatedAt)} 自动升级值班员处置`}
        description={
          esc.ackedAt
            ? `值班员 ${esc.ackedBy} 已于 ${fmtTime(esc.ackedAt)} 接管，按流程电话核实 → 无果派单上门`
            : '请值班员立即接管：先电话核实老人情况，无果后派网格员上门'
        }
      />
      <Descriptions
        column={1}
        size="small"
        bordered
        items={[
          {
            key: 'addr',
            label: (
              <span>
                <HomeOutlined /> 老人住址
              </span>
            ),
            children: (
              <Text strong>
                {elder.address}（{elder.name}，{elder.age}岁，电话 {elder.phone}）
              </Text>
            ),
          },
          {
            key: 'activity',
            label: (
              <span>
                <ClockCircleOutlined /> 最近活动
              </span>
            ),
            children: latestPlaces.map((t) => `${fmtTime(t.at)} ${t.place}`).join(' → ') || '暂无轨迹',
          },
          {
            key: 'access',
            label: '门禁备注',
            children: elder.accessInfo,
          },
          {
            key: 'key',
            label: (
              <span>
                <KeyOutlined /> 钥匙托管
              </span>
            ),
            children: elder.keyCustody,
          },
        ]}
      />
      <Space style={{ marginTop: 12 }} wrap>
        {!esc.ackedAt && event.status !== 'closed' && (
          <Button type="primary" danger onClick={() => ackDuty(event.id)}>
            立即接管（值班员）
          </Button>
        )}
        {esc.ackedAt && (
          <Tag color="green">
            已接管：{esc.ackedBy} {fmtTime(esc.ackedAt)}
          </Tag>
        )}
        <Tag icon={<PhoneOutlined />} color={noAnswerCount > 0 ? 'red' : 'default'}>
          电话核实 {event.phoneAttempts.length} 次{noAnswerCount > 0 ? `（${noAnswerCount} 次无人接听）` : ''}
        </Tag>
        {noAnswerCount > 0 && !event.doorVisit && <Tag color="volcano">电话核实无果，可派网格员上门</Tag>}
      </Space>
    </Card>
  )
}

export default DutyEscalationPanel
