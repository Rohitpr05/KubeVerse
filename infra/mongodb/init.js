// Sample-only seed data proves that MongoDB is local; application paths do not rely on real customer data.
db = db.getSiblingDB('simulator');
db.samples.insertMany([
  { documentName: 'sample-invoice.pdf', category: 'demo', createdAt: new Date() },
  { documentName: 'training-contract.pdf', category: 'demo', createdAt: new Date() }
]);
