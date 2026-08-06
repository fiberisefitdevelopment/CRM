import { NextRequest } from 'next/server'
import { bulkUploadAayshOrders } from '@/src/services/aayshExpressClient'
import { withAayshAuth } from '@/src/services/aayshExpressRouteHelper'

export async function POST(req: NextRequest) {
  return withAayshAuth(req, async () => {
    const formData = await req.formData()
    const file = formData.get('file')
    if (!file || !(file instanceof Blob)) {
      throw new Error('file is required')
    }
    const filename = file instanceof File ? file.name : 'upload.xlsx'
    return bulkUploadAayshOrders(file, filename)
  })
}
