import dns from 'node:dns';
import mongoose from 'mongoose';
import { config } from './config.js';
import { logger } from './logger.js';

// Some resolvers (a stub resolver on 127.0.0.1 from VPN/ad-blocker/DNS-cloak
// tools is the common one on Windows) accept normal A/SRV queries but refuse
// the SRV lookup `mongodb+srv://` needs, which crashes boot with the misleading
// "querySrv ECONNREFUSED". Before blaming the cluster, preflight the SRV
// record; if the default resolver can't answer it, retry with public DNS.
async function ensureSrvResolution(uri) {
  if (!uri.startsWith('mongodb+srv://')) return;
  let host;
  try {
    host = new URL(uri).hostname;
  } catch {
    return; // let mongoose report the malformed URI itself
  }
  const srv = `_mongodb._tcp.${host}`;
  try {
    await dns.promises.resolveSrv(srv);
  } catch (err) {
    if (err.code !== 'ECONNREFUSED' && err.code !== 'ESERVFAIL' && err.code !== 'ETIMEDOUT' && err.code !== 'EAI_AGAIN') {
      throw err; // e.g. ENODATA/ENOTFOUND — the hostname really doesn't exist
    }
    logger.warn(
      { srv, reason: err.code, fallbackDns: ['8.8.8.8', '1.1.1.1'] },
      'local DNS resolver cannot answer SRV queries; retrying with public DNS',
    );
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }
}

export async function connectDb(uri = config.MONGO_URI) {
  mongoose.set('strictQuery', true);
  await ensureSrvResolution(uri);
  await mongoose.connect(uri);
  logger.info({ db: mongoose.connection.name }, 'connected to mongodb');
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
