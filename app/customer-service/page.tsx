'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function CustomerServicePage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/customer-service/dashboard')
  }, [router])

  return null
}
