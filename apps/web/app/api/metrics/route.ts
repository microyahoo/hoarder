import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { register } from '@hoarder/shared/metrics';
import serverConfig from '@hoarder/shared/config';

export async function GET(request: NextRequest) {
  try {
    // 检查认证，只允许管理员访问
    const session = await getServerSession();
    if (!session?.user?.email) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    // 从配置中获取管理员邮箱列表
    const adminEmails = serverConfig.admin?.emails || [];
    if (!adminEmails.includes(session.user.email)) {
      return new NextResponse('Forbidden', { status: 403 });
    }

    // 获取所有指标
    const metrics = await register.metrics();

    // 返回 Prometheus 格式的指标
    return new NextResponse(metrics, {
      headers: {
        'Content-Type': register.contentType,
      },
    });
  } catch (error) {
    console.error('Error while generating metrics:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}