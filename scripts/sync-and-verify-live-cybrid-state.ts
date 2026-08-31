import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();
const API_URL = 'http://localhost:3001/api/v1';

async function getCybridAuthToken(): Promise<{ token: string; baseUrl: string; bankGuid: string }> {
  const clientId = process.env.CYBRID_CLIENT_ID;
  const clientSecret = process.env.CYBRID_CLIENT_SECRET;
  const idpUrl = process.env.CYBRID_IDP_URL || 'https://id.sandbox.cybrid.app';
  const baseUrl = process.env.CYBRID_BASE_URL || 'https://bank.sandbox.cybrid.app';
  const bankGuid = process.env.CYBRID_BANK_GUID || '';

  const scopes = [
    'transfers:read transfers:execute',
    'trades:read trades:execute',
    'accounts:read',
    'customers:read',
  ].join(' ');

  const res = await axios.post(
    `${idpUrl}/oauth/token`,
    {
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: scopes,
    },
    { headers: { 'Content-Type': 'application/json' } }
  );

  return { token: res.data.access_token, baseUrl, bankGuid };
}

async function syncLiveCybridState() {
  console.log('=== SYNCING LIVE REAL CYBRID TRANSFERS & TRADES TO AGNCYPAY ===\n');

  const { token, baseUrl } = await getCybridAuthToken();
  const cybridHeaders = { headers: { Authorization: `Bearer ${token}` } };

  // 1. Fetch live transfers from Cybrid Sandbox
  const transfersRes = await axios.get(`${baseUrl}/api/transfers?per_page=10`, cybridHeaders);
  const liveTransfers = transfersRes.data.objects || [];

  console.log(`Found ${liveTransfers.length} live transfers in Cybrid Sandbox:`);

  for (const t of liveTransfers) {
    console.log(`\n--- Live Transfer: ${t.guid} ---`);
    console.log(`  State: ${t.state}`);
    console.log(`  Side: ${t.side}`);
    console.log(`  Asset: ${t.asset}`);
    console.log(`  Failure Code: ${t.failure_code || 'none'}`);
    console.log(`  Amount: ${t.amount || t.estimated_amount}`);

    // Deliver exact real Cybrid event to webhook processor
    const liveWebhookPayload = {
      event_type: `transfer.${t.state}`,
      object_guid: t.guid,
      guid: `live_sync_${t.guid}_${Date.now()}`,
      transfer_guid: t.guid,
      state: t.state,
      failure_code: t.failure_code,
      amount: t.amount || t.estimated_amount,
      asset: t.asset,
    };

    try {
      const webhookRes = await axios.post(`${API_URL}/webhooks/cybrid`, liveWebhookPayload);
      console.log(`  ✅ Synced with AgncyPay Webhook:`, webhookRes.data.status);
    } catch (e: any) {
      console.log(`  Webhook sync response:`, e.response?.status, e.response?.data || e.message);
    }

    // Check DB status for this transfer
    const dbPayout = await prisma.paymentPayout.findFirst({
      where: { cybridTransferGuid: t.guid },
    });
    if (dbPayout) {
      console.log(`  📊 DB Payout Record [${dbPayout.payoutNumber}]: Status = ${dbPayout.status} | Failure Reason = ${dbPayout.failureReason || 'none'}`);
    }
  }

  // 2. Fetch live trades from Cybrid Sandbox
  console.log('\n=============================================================');
  console.log('=== SYNCING LIVE REAL CYBRID TRADES ===');
  const tradesRes = await axios.get(`${baseUrl}/api/trades?per_page=10`, cybridHeaders);
  const liveTrades = tradesRes.data.objects || [];
  console.log(`Found ${liveTrades.length} live trades in Cybrid Sandbox:`);

  for (const tr of liveTrades) {
    console.log(`\n--- Live Trade: ${tr.guid} ---`);
    console.log(`  State: ${tr.state}`);
    console.log(`  Symbol: ${tr.symbol}`);
    console.log(`  Receive Amount: ${tr.receive_amount}`);
    console.log(`  Deliver Amount: ${tr.deliver_amount}`);

    const tradeWebhookPayload = {
      event_type: `trade.${tr.state}`,
      object_guid: tr.guid,
      guid: `live_sync_trade_${tr.guid}_${Date.now()}`,
      trade_guid: tr.guid,
      state: tr.state,
    };

    try {
      const webhookRes = await axios.post(`${API_URL}/webhooks/cybrid`, tradeWebhookPayload);
      console.log(`  ✅ Synced Trade with AgncyPay Webhook:`, webhookRes.data.status);
    } catch (e: any) {
      console.log(`  Trade webhook sync response:`, e.response?.status, e.response?.data || e.message);
    }

    const dbPayoutTrade = await prisma.paymentPayout.findFirst({
      where: { cybridTradeGuid: tr.guid },
    });
    if (dbPayoutTrade) {
      console.log(`  📊 DB Payout Record [${dbPayoutTrade.payoutNumber}]: Status = ${dbPayoutTrade.status}`);
    }
  }
}

syncLiveCybridState()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
