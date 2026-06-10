/**
 * AiSensy Service — Post-Delivery Journey WhatsApp Campaigns
 *
 * Dedicated service for dispatching specific customer journey campaigns
 * via the AiSensy WhatsApp API.
 *
 * API endpoint: POST https://backend.aisensy.com/campaign/t1/api/v2
 */

import axios from 'axios';
import { normalizePhoneNumber } from './whatsapp.service';

const BASE_URL = process.env.AISENSY_BASE_URL || 'https://backend.aisensy.com/campaign/t1/api/v2';

/**
 * Generic helper to send an AiSensy template message.
 */
async function sendCampaign(
  campaignName: string | undefined,
  phone: string,
  userName: string,
  params: string[]
): Promise<any> {
  const apiKey = process.env.AISENSY_API_KEY;

  if (!apiKey) {
    throw new Error('AISENSY_API_KEY is not configured in environment variables');
  }

  if (!campaignName) {
    throw new Error('Campaign name environment variable is not defined');
  }

  const normalizedPhone = normalizePhoneNumber(phone);

  const payload = {
    apiKey,
    campaignName,
    destination: normalizedPhone,
    userName: userName || 'Customer',
    templateParams: params || [],
  };

  console.log(`📤 Sending AiSensy Campaign [${campaignName}] to ${normalizedPhone} with params:`, params);

  const response = await axios.post(BASE_URL, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });

  return response.data;
}

/**
 * Day 0: Immediately send FYBER Delivery Welcome template.
 */
export async function sendWelcomeTemplate(
  phone: string,
  customerName: string,
  orderId: string,
  products: string[],
  orderAmount: number
): Promise<any> {
  const campaignName = process.env.AISENSY_CAMPAIGN_DAY0;
  const params: string[] = [];
  return sendCampaign(campaignName, phone, customerName, params);
}

/**
 * Day 1: Send FYBER Reminder template.
 */
export async function sendDay1Template(
  phone: string,
  customerName: string,
  orderId: string
): Promise<any> {
  const campaignName = process.env.AISENSY_CAMPAIGN_DAY1;
  const params: string[] = [customerName];
  return sendCampaign(campaignName, phone, customerName, params);
}

/**
 * Day 3: Send FYBER Usage Tips template.
 */
export async function sendDay3Template(
  phone: string,
  customerName: string,
  orderId: string,
  products: string[]
): Promise<any> {
  const campaignName = process.env.AISENSY_CAMPAIGN_DAY3;
  const params: string[] = [];
  return sendCampaign(campaignName, phone, customerName, params);
}

/**
 * Day 4: Send FYBER Benefits template.
 */
export async function sendDay4Template(
  phone: string,
  customerName: string
): Promise<any> {
  const campaignName = process.env.AISENSY_CAMPAIGN_DAY4;
  const params: string[] = [];
  return sendCampaign(campaignName, phone, customerName, params);
}

/**
 * Day 5: Send FYBER Day 5 template.
 */
export async function sendDay5Template(
  phone: string,
  customerName: string
): Promise<any> {
  const campaignName = process.env.AISENSY_CAMPAIGN_DAY5;
  const params: string[] = [];
  return sendCampaign(campaignName, phone, customerName, params);
}
