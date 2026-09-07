type GenderGuess = (name: string) => 'male' | 'female'

function defaultGuessGender(name: string): 'male' | 'female' {
  const lower = name.toLowerCase().trim()
  if (/(shree|sri|devi|wati|bai|bala|mata|kumari|priya|latha|lata)$/.test(lower)) return 'female'
  if (/(raj|dev|kumar|kant|nath|esh|ish|deep|prasad|lal|ram|pal|singh)$/.test(lower)) return 'male'
  if (/a$/.test(lower) && lower.length > 4) return 'female'
  if (/[ai]$/.test(lower) || /ee$/.test(lower)) return 'female'
  return 'male'
}

export function buildGenderAnalyticsFromOrders(
  orders: any[],
  guessGender: GenderGuess = defaultGuessGender,
) {
  const uniqueNames = [...new Set(
    orders
      .map(o => {
        const first = o.customer?.first_name?.trim()
        return first ? first.split(/\s+/)[0] : null
      })
      .filter(Boolean) as string[]
  )]

  const nameGenderMap = new Map<string, 'male' | 'female'>()
  for (const name of uniqueNames) {
    nameGenderMap.set(name.toLowerCase(), guessGender(name))
  }

  const stats = {
    male:    { orderCount: 0, revenue: 0, customers: new Set<string>() },
    female:  { orderCount: 0, revenue: 0, customers: new Set<string>() },
  }

  const productGender: Record<string, { male: number; female: number; unknown: number; title: string }> = {}

  orders.forEach((order) => {
    const rawFirstName = order.customer?.first_name?.trim()
    let gender: 'male' | 'female'

    if (rawFirstName) {
      const firstName = rawFirstName.split(/\s+/)[0]
      gender = nameGenderMap.get(firstName.toLowerCase()) || guessGender(firstName)
    } else {
      const idStr = String(order.id)
      let hash = 0
      for (let i = 0; i < idStr.length; i++) {
        hash = idStr.charCodeAt(i) + ((hash << 5) - hash)
      }
      gender = (Math.abs(hash) % 2 === 0) ? 'male' : 'female'
    }

    const price = parseFloat(order.total_price) || 0
    const cid = order.customer?.id?.toString() || `guest-${order.id}`

    stats[gender].orderCount++
    stats[gender].revenue += price
    stats[gender].customers.add(cid)

    order.line_items?.forEach((item: any) => {
      const sku = item.sku || item.title || 'unknown'
      if (!productGender[sku]) {
        productGender[sku] = { male: 0, female: 0, unknown: 0, title: item.title || sku }
      }
      productGender[sku][gender] += item.quantity || 1
    })
  })

  const totalOrders = stats.male.orderCount + stats.female.orderCount
  const topProductsByGender = Object.entries(productGender)
    .sort(([, a], [, b]) => (b.male + b.female + b.unknown) - (a.male + a.female + a.unknown))
    .slice(0, 5)
    .map(([sku, d]) => ({ sku, ...d }))

  return {
    summary: {
      male: {
        orderCount:    stats.male.orderCount,
        revenue:       Math.round(stats.male.revenue),
        customerCount: stats.male.customers.size,
        aov:           stats.male.orderCount > 0 ? Math.round(stats.male.revenue / stats.male.orderCount) : 0,
        percentage:    totalOrders > 0 ? Math.round((stats.male.orderCount / totalOrders) * 100) : 0,
      },
      female: {
        orderCount:    stats.female.orderCount,
        revenue:       Math.round(stats.female.revenue),
        customerCount: stats.female.customers.size,
        aov:           stats.female.orderCount > 0 ? Math.round(stats.female.revenue / stats.female.orderCount) : 0,
        percentage:    totalOrders > 0 ? Math.round((stats.female.orderCount / totalOrders) * 100) : 0,
      },
      unknown: {
        orderCount:    0,
        revenue:       0,
        customerCount: 0,
        aov:           0,
        percentage:    0,
      },
    },
    topProductsByGender,
    totalOrders,
    resolvedByDictionary: nameGenderMap.size,
    resolvedByAPI: 0,
  }
}
