import { MongoClient } from 'mongodb';
const c = new MongoClient(process.env.MONGO_URI);
await c.connect();
const db = c.db();
const doc = await db.collection('stocksportfolios').findOne({ email: 'rgsommer@me.com' });
console.log(JSON.stringify(doc));
await c.close();
