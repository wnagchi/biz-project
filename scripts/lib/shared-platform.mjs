import { inspectRecordsCenter } from './projects.mjs';
import { descriptor, probeService, resumeService, servicePolicy } from './service-runtime.mjs';
import { processAlive } from './process-lease.mjs';
import { startPlatformWeb } from './platform-web.mjs';

// Production launchers share one identity/lease. In-process library fixtures opt in.
export async function startSharedPlatform(options = {}) {
  const center = inspectRecordsCenter({ config: options.configFile, 'records-root': options.recordsRoot });
  if (center.registry && !center.records_root_confirmation_required) {
    if (options.background && servicePolicy(center).stopped) throw new Error('用户已主动停止服务，自动启动已取消。');
    const existing = await probeService(center);
    if (existing) {
      if (!options.background) resumeService(center);
      return { url: existing.value.url, lanUrls: [], owned: false, close: async () => {}, stop: async () => {} };
    }
    const old = descriptor(center);
    if (old && processAlive(old.pid)) throw new Error('已有服务进程未响应；请检查或手动停止它，不会启动重复服务。');
  } else if (options.background) throw new Error('自动启动需要已确认的记录中心。');
  return startPlatformWeb({ ...options, managedService: true });
}
