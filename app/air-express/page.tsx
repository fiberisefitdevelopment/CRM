'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AirExpressPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/air-express/orders')
  }, [router])

  return null
}
