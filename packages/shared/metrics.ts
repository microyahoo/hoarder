import { Counter, Gauge, Histogram, Registry } from 'prom-client';

// 创建一个新的 Registry
export const register = new Registry();

// 爬虫请求计数器
export const crawlerRequestsTotal = new Counter({
  name: 'crawler_requests_total',
  help: 'Total number of requests made by the crawler',
  labelNames: ['status', 'domain'] as const,
  registers: [register],
});

// 爬虫请求延迟直方图
export const crawlerRequestDuration = new Histogram({
  name: 'crawler_request_duration_seconds',
  help: 'Duration of crawler requests in seconds',
  labelNames: ['domain'] as const,
  buckets: [0.1, 0.5, 1, 2, 5],
  registers: [register],
});

// 当前活跃请求数
export const crawlerActiveRequests = new Gauge({
  name: 'crawler_active_requests',
  help: 'Number of currently active crawler requests',
  labelNames: ['domain'] as const,
  registers: [register],
});

// 代理可用性指标
export const proxyAvailability = new Gauge({
  name: 'crawler_proxy_availability',
  help: 'Availability of proxies (1 for available, 0 for unavailable)',
  labelNames: ['proxy'] as const,
  registers: [register],
});

// 爬虫错误计数器
export const crawlerErrors = new Counter({
  name: 'crawler_errors_total',
  help: 'Total number of crawler errors',
  labelNames: ['type', 'domain'] as const,
  registers: [register],
});

// Cookie 会话计数器
export const crawlerActiveSessions = new Gauge({
  name: 'crawler_active_sessions',
  help: 'Number of active crawler sessions with valid cookies',
  labelNames: ['domain'] as const,
  registers: [register],
});

// 内存使用指标
export const crawlerMemoryUsage = new Gauge({
  name: 'crawler_memory_usage_bytes',
  help: 'Memory usage of the crawler process in bytes',
  registers: [register],
});

// 爬虫队列大小
export const crawlerQueueSize = new Gauge({
  name: 'crawler_queue_size',
  help: 'Number of URLs in the crawler queue',
  labelNames: ['priority'] as const,
  registers: [register],
});

// 导出所有指标的辅助函数
export async function getMetrics(): Promise<string> {
  return register.metrics();
}

// 重置所有指标的辅助函数
export function resetMetrics(): void {
  register.resetMetrics();
}