import React from 'react'
import { Card, List, Space, Tag, Typography } from 'antd'
import {
  AlertOutlined,
  CheckCircleOutlined,
  FileDoneOutlined,
  HomeOutlined,
  MedicineBoxOutlined,
  PhoneOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons'
import { AlertEvent } from '../types'
import { fmtTime } from './common'

const { Text } = Typography

interface ActionItem {
  icon: React.ReactNode
  color: string
  text: string
  at?: number
}

/** 家属视角：社区已采取的动作（家属超时后响应时可清楚看到处置进展） */
const ActionsTaken: React.FC<{ event: AlertEvent }> = ({ event }) => {
  const items: ActionItem[] = []

  if (event.dutyEscalation) {
    items.push({
      icon: <UserSwitchOutlined />,
      color: 'red',
      text: `因您未及时确认，事件已自动升级社区值班员${event.dutyEscalation.ackedBy ? `（${event.dutyEscalation.ackedBy} 已接管）` : ''}`,
      at: event.dutyEscalation.escalatedAt,
    })
  }
  event.phoneAttempts.forEach((a) =>
    items.push({
      icon: <PhoneOutlined />,
      color: a.result === 'answered' ? 'green' : 'orange',
      text: `值班员电话核实：${a.result === 'answered' ? '老人已接听，状态平稳' : '老人电话无人接听'}${a.note ? `（${a.note}）` : ''}`,
      at: a.at,
    }),
  )
  if (event.doorVisit) {
    const dv = event.doorVisit
    items.push({ icon: <HomeOutlined />, color: 'purple', text: `已派网格员 ${dv.assignee} 上门`, at: dv.dispatchedAt })
    if (dv.arrivedAt) {
      items.push({
        icon: <HomeOutlined />,
        color: 'purple',
        text: `网格员已到达（${dv.propertyContacted ? '已联系物业' : '未联系物业'}${dv.firstAidNeeded ? '，现场判断需要急救' : ''}）`,
        at: dv.arrivedAt,
      })
    }
    if (dv.propertyInvolved) items.push({ icon: <HomeOutlined />, color: 'volcano', text: dv.usedKeyCustody ? '已联动物业并使用托管钥匙入户' : '已联动物业协助开门' })
    if (dv.result) {
      items.push({
        icon: <HomeOutlined />,
        color: dv.result === 'ok' ? 'green' : 'volcano',
        text: { ok: '上门确认老人平安', no_answer: '上门无人开门', need_medical: '上门发现需医疗处置' }[dv.result],
      })
    }
    if (dv.siteReport) {
      items.push({
        icon: <FileDoneOutlined />,
        color: 'geekblue',
        text: `现场报告：${dv.siteReport.result}；老人状态：${dv.siteReport.elderStatus}；${dv.siteReport.sentToHospital ? '已送医' : '未送医'}${
          dv.siteReport.needRevisit ? '；需后续复访' : ''
        }`,
        at: dv.siteReport.at,
      })
    }
  }
  if (event.medical?.called120) items.push({ icon: <AlertOutlined />, color: 'red', text: '已呼叫120急救', at: event.medical.at })
  if (event.medical?.hospital) items.push({ icon: <MedicineBoxOutlined />, color: 'volcano', text: `已送医：${event.medical.hospital}（${event.medical.outcome}）` })
  if (event.followUp) items.push({ icon: <CheckCircleOutlined />, color: 'cyan', text: `社区已回访：${event.followUp.note}`, at: event.followUp.at })

  return (
    <Card size="small" title="社区已采取的动作" style={{ marginTop: 12 }}>
      {items.length === 0 ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          社区值班中心已收到告警，暂无进一步处置动作。
        </Text>
      ) : (
        <List
          size="small"
          dataSource={items}
          renderItem={(it) => (
            <List.Item style={{ padding: '4px 0' }}>
              <Space size={8}>
                <Tag color={it.color} icon={it.icon} style={{ marginRight: 0 }} />
                <Text style={{ fontSize: 12 }}>{it.text}</Text>
                {it.at && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {fmtTime(it.at)}
                  </Text>
                )}
              </Space>
            </List.Item>
          )}
        />
      )}
    </Card>
  )
}

export default ActionsTaken
