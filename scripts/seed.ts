import { db, pool } from '../lib/db/index';
import { rfqs, rfqLineItems, auditLog } from '../lib/db/schema';
import { randomUUID } from 'crypto';

interface SeedRfq {
  id: string;
  title: string;
  status: 'draft' | 'pending' | 'awarded' | 'closed';
}

interface SeedLineItem {
  description: string;
  quantity: string;
  unitPrice: string;
}

const seedRfqs: SeedRfq[] = [
  {
    id: randomUUID(),
    title: 'W251 BOP Wellhead Equipment Procurement',
    status: 'pending'
  },
  {
    id: randomUUID(),
    title: 'Subsea Control Module RFQ Q1-2025',
    status: 'draft'
  },
  {
    id: randomUUID(),
    title: 'Emergency Valve Assembly Award Package',
    status: 'awarded'
  }
];

const lineItemsPerRfq: SeedLineItem[][] = [
  [
    {
      description: 'BOP Stack Assembly 15,000 PSI',
      quantity: '4.0000',
      unitPrice: '15750.0000'
    },
    {
      description: 'Wellhead Connector Package',
      quantity: '12.5000',
      unitPrice: '8200.5000'
    }
  ],
  [
    {
      description: 'Subsea Control Pod HPU Unit',
      quantity: '2.0000',
      unitPrice: '125000.0000'
    },
    {
      description: 'Umbilical Termination Assembly',
      quantity: '6.0000',
      unitPrice: '18500.7500'
    }
  ],
  [
    {
      description: 'Emergency Disconnect Valve DN200',
      quantity: '8.0000',
      unitPrice: '22750.2500'
    },
    {
      description: 'Actuator Assembly Pneumatic',
      quantity: '16.0000',
      unitPrice: '4500.1250'
    }
  ]
];

async function seed() {
  try {
    console.log('Starting database seed...');
    
    await db.transaction(async (tx) => {
      let rfqCount = 0;
      let lineItemCount = 0;
      let auditLogCount = 0;

      for (let i = 0; i < seedRfqs.length; i++) {
        const seedRfq = seedRfqs[i];
        const lineItems = lineItemsPerRfq[i];

        // Insert RFQ
        const insertedRfq = await tx.insert(rfqs).values({
          id: seedRfq.id,
          title: seedRfq.title,
          status: seedRfq.status
        }).returning();
        
        rfqCount++;

        // Insert audit log for RFQ
        await tx.insert(auditLog).values({
          tableName: 'rfqs',
          recordId: seedRfq.id,
          action: 'INSERT',
          changedBy: 'seed-script',
          payload: insertedRfq[0]
        });
        auditLogCount++;

        // Insert line items for this RFQ
        const lineItemValues = lineItems.map(item => ({
          rfqId: seedRfq.id,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice
        }));

        const insertedLineItems = await tx.insert(rfqLineItems).values(lineItemValues).returning();
        lineItemCount += insertedLineItems.length;

        // Insert audit log for line items bulk insert
        await tx.insert(auditLog).values({
          tableName: 'rfq_line_items',
          recordId: seedRfq.id, // Reference the parent RFQ
          action: 'INSERT',
          changedBy: 'seed-script',
          payload: insertedLineItems
        });
        auditLogCount++;
      }

      console.log(`Seed completed successfully:`);
      console.log(`- RFQs inserted: ${rfqCount}`);
      console.log(`- Line items inserted: ${lineItemCount}`);
      console.log(`- Audit log entries inserted: ${auditLogCount}`);
    });
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();