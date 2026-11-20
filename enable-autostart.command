#!/bin/bash
# =============================================================================
#  测试工程师资讯平台 · 开启开机自启（launchd 常驻）
# -----------------------------------------------------------------------------
#  作用：把开发服务注册为「开机自动启动 + 崩溃自动拉起」，彻底解决
#        「每次会话结束后 5173 端口就没服务、登录失败」的问题。
#  用法：在 Finder 里双击运行（只需执行一次，之后永久生效）。
# =============================================================================

LABEL="com.qanewshub.dev"
PLIST="$HOME/Library/LaunchAgents/com.qanewshub.dev.plist"
PROJECT_DIR="$HOME/WorkBuddy/2026-09-02-17-23-39/zhuansu-ai-workbench"
LOG="$PROJECT_DIR/.launchd-dev.log"

BOLD='\033[1m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
RED='\033[0;31m'; YELLOW='\033[0;33m'; NC='\033[0m'

echo ""
echo "${CYAN}==================================================${NC}"
echo "${CYAN}  开启开机自启 · ${LABEL}${NC}"
echo "${CYAN}==================================================${NC}"

# 1. 检查 plist
if [ ! -f "$PLIST" ]; then
  echo "${RED}❌ 找不到 $PLIST${NC}"
  exit 1
fi
echo "${GREEN}✓${NC} 配置文件已就绪"

# 2. 先卸载旧实例（若已加载），避免 "already loaded"
launchctl unload "$PLIST" 2>/dev/null || true
echo "${GREEN}✓${NC} 已清理旧实例"

# 3. 释放 5173 端口（当前占用者，通常是临时启动的 vite）
PIDS=$(lsof -ti tcp:5173 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  echo "${YELLOW}>> 释放 5173 端口占用（PID: $PIDS）...${NC}"
  echo "$PIDS" | xargs kill -9 2>/dev/null || true
  sleep 2
else
  echo "${GREEN}✓${NC} 5173 端口空闲"
fi

# 4. 加载常驻服务
echo "${CYAN}>> 注册为开机自启 + 崩溃自拉起...${NC}"
if launchctl load "$PLIST" 2>/tmp/launchctl.err; then
  echo "${GREEN}✓${NC} launchctl load 成功"
else
  echo "${RED}❌ launchctl load 失败：${NC}"
  cat /tmp/launchctl.err 2>/dev/null
  exit 1
fi

# 5. 等待服务就绪
echo "${CYAN}>> 等待服务启动...${NC}"
OK=0
for i in $(seq 1 40); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:5173/ 2>/dev/null || echo "000")
  if [ "$CODE" = "200" ]; then OK=1; break; fi
  sleep 1
done

echo ""
if [ "$OK" = "1" ]; then
  echo "${GREEN}${BOLD}✅ 成功！服务已常驻${NC}"
  echo "${GREEN}   http://localhost:5173/#/login${NC}"
  echo "   账号 admin-demo / 1234567890"
  echo ""
  echo "${CYAN}现在起：开机自动启动、进程崩溃自动拉起，无需再手动 npm run dev。${NC}"
else
  echo "${YELLOW}⚠️  已注册，但 40 秒内未探测到服务（首次启动可能较慢）。${NC}"
  echo "   请查看日志：$LOG"
  echo "   或手动检查：curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/"
fi

echo ""
echo "${CYAN}--------------------------------------------------${NC}"
echo "常用命令（在终端执行）："
echo "  查看状态: launchctl list | grep qanewshub"
echo "  停止:     launchctl unload $PLIST"
echo "  重启:     launchctl unload $PLIST && launchctl load $PLIST"
echo "  取消自启: launchctl unload $PLIST && rm $PLIST"
echo "  日志:     tail -f $LOG"
echo "${CYAN}--------------------------------------------------${NC}"
echo ""
