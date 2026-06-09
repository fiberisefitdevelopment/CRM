/**
 * India Zones & Pincode Intelligence
 * Maps Indian states → zones and pincode prefixes → state
 */

export type IndiaZone = 'North' | 'South' | 'East' | 'West' | 'Central' | 'North-East'

export const STATE_TO_ZONE: Record<string, IndiaZone> = {
  // North
  'Delhi':                      'North',
  'Haryana':                    'North',
  'Himachal Pradesh':           'North',
  'Jammu and Kashmir':          'North',
  'Ladakh':                     'North',
  'Punjab':                     'North',
  'Rajasthan':                  'North',
  'Uttarakhand':                'North',
  'Uttar Pradesh':              'North',

  // South
  'Andhra Pradesh':             'South',
  'Karnataka':                  'South',
  'Kerala':                     'South',
  'Lakshadweep':                'South',
  'Puducherry':                 'South',
  'Tamil Nadu':                 'South',
  'Telangana':                  'South',
  'Andaman and Nicobar Islands':'South',

  // East
  'Bihar':                      'East',
  'Jharkhand':                  'East',
  'Odisha':                     'East',
  'West Bengal':                'East',

  // West
  'Dadra and Nagar Haveli and Daman and Diu': 'West',
  'Goa':                        'West',
  'Gujarat':                    'West',
  'Maharashtra':                'West',

  // Central
  'Chhattisgarh':               'Central',
  'Madhya Pradesh':             'Central',

  // North-East
  'Arunachal Pradesh':          'North-East',
  'Assam':                      'North-East',
  'Manipur':                    'North-East',
  'Meghalaya':                  'North-East',
  'Mizoram':                    'North-East',
  'Nagaland':                   'North-East',
  'Sikkim':                     'North-East',
  'Tripura':                    'North-East',
}

// Common Shopify province abbreviations → full state name
export const PROVINCE_ALIASES: Record<string, string> = {
  'DL': 'Delhi',  'HR': 'Haryana', 'HP': 'Himachal Pradesh',
  'JK': 'Jammu and Kashmir', 'LA': 'Ladakh', 'PB': 'Punjab',
  'RJ': 'Rajasthan', 'UK': 'Uttarakhand', 'UP': 'Uttar Pradesh',
  'AP': 'Andhra Pradesh', 'KA': 'Karnataka', 'KL': 'Kerala',
  'PY': 'Puducherry', 'TN': 'Tamil Nadu', 'TS': 'Telangana',
  'TG': 'Telangana', 'AN': 'Andaman and Nicobar Islands',
  'BR': 'Bihar', 'JH': 'Jharkhand', 'OD': 'Odisha',
  'OR': 'Odisha', 'WB': 'West Bengal',
  'DD': 'Dadra and Nagar Haveli and Daman and Diu',
  'GA': 'Goa', 'GJ': 'Gujarat', 'MH': 'Maharashtra',
  'CT': 'Chhattisgarh', 'CG': 'Chhattisgarh', 'MP': 'Madhya Pradesh',
  'AR': 'Arunachal Pradesh', 'AS': 'Assam', 'MN': 'Manipur',
  'ML': 'Meghalaya', 'MZ': 'Mizoram', 'NL': 'Nagaland',
  'SK': 'Sikkim', 'TR': 'Tripura',
}

export const ZONE_COLORS: Record<IndiaZone, string> = {
  'North':      '#7C3AED',   // Purple
  'South':      '#059669',   // Green
  'East':       '#2563EB',   // Blue
  'West':       '#D97706',   // Amber
  'Central':    '#DC2626',   // Red
  'North-East': '#0891B2',   // Cyan
}

export const ZONE_LIGHT_COLORS: Record<IndiaZone, string> = {
  'North':      'rgba(124,58,237,0.15)',
  'South':      'rgba(5,150,105,0.15)',
  'East':       'rgba(37,99,235,0.15)',
  'West':       'rgba(217,119,6,0.15)',
  'Central':    'rgba(220,38,38,0.15)',
  'North-East': 'rgba(8,145,178,0.15)',
}

export const ZONES: IndiaZone[] = ['North', 'South', 'East', 'West', 'Central', 'North-East']

export function resolveProvince(province: string | null | undefined): string | null {
  if (!province) return null
  const upper = province.trim().toUpperCase()
  return PROVINCE_ALIASES[upper] || province.trim()
}

export function getZoneForState(state: string | null | undefined): IndiaZone | null {
  if (!state) return null
  const resolved = resolveProvince(state)
  return STATE_TO_ZONE[resolved || ''] || null
}

export interface ZoneStats {
  zone: IndiaZone
  orderCount: number
  revenue: number
  codCount: number
  deliveredCount: number
  rtoCount: number
  states: Record<string, { orderCount: number; revenue: number }>
  color: string
}

export function buildZoneStats(orders: any[]): Record<IndiaZone, ZoneStats> {
  const result: Record<IndiaZone, ZoneStats> = {} as any

  ZONES.forEach((z) => {
    result[z] = {
      zone: z,
      orderCount: 0,
      revenue: 0,
      codCount: 0,
      deliveredCount: 0,
      rtoCount: 0,
      states: {},
      color: ZONE_COLORS[z],
    }
  })

  orders.forEach((order) => {
    const province = order.shipping_address?.province
    const stateName = resolveProvince(province)
    const zone = stateName ? STATE_TO_ZONE[stateName] : null
    if (!zone) return

    const price = parseFloat(order.total_price) || 0
    const isCOD = order.financial_status?.toLowerCase() !== 'paid'
    const status = (order.fulfillments?.[0]?.shipment_status || '').toLowerCase()
    const isDelivered = status === 'delivered'
    const isRTO = ['failure', 'rto', 'returned'].includes(status)

    result[zone].orderCount++
    result[zone].revenue += price
    if (isCOD) result[zone].codCount++
    if (isDelivered) result[zone].deliveredCount++
    if (isRTO) result[zone].rtoCount++

    if (stateName) {
      if (!result[zone].states[stateName]) {
        result[zone].states[stateName] = { orderCount: 0, revenue: 0 }
      }
      result[zone].states[stateName].orderCount++
      result[zone].states[stateName].revenue += price
    }
  })

  return result
}
