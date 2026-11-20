#!/bin/bash
# =============================================================================
#  测试工程师资讯平台 · 一键启动器（macOS 双击运行）
# -----------------------------------------------------------------------------
#  · 可选 = 公共在线翻译（零配置，但可能受网络与限流影响）
#  · 推荐 = 本地 Ollama（qwen2.5:3b），完全免费，首次下载约 2GB，之后可离线翻译
#  启动后浏览器打开 http://localhost:5173/#/login
#  账号 admin-demo / 1234567890
# =============================================================================

# 无论在哪双击，都切到脚本自身所在目录（即项目根目录）
cd "$(dirname "$0")" || exit 1
PROJECT_DIR="$(pwd)"

# 从项目 .env 读取可选翻译配置；只读取简单 KEY=VALUE，避免执行文件内容。
if [ -f ".env" ]; then
  while IFS='=' read -r ENV_KEY ENV_VALUE; do
    case "$ENV_KEY" in
      DEEPL_API_KEY|DEEPL_API_URL|LOCAL_LLM_URL|LOCAL_LLM_MODEL|DISABLE_FREE_TRANSLATE)
        ENV_VALUE="${ENV_VALUE#\"}"; ENV_VALUE="${ENV_VALUE%\"}"
        export "$ENV_KEY=$ENV_VALUE"
        ;;
    esac
  done < <(sed -n 's/^[[:space:]]*\([^#][A-Za-z_][A-Za-z0-9_]*\)[[:space:]]*=[[:space:]]*\(.*\)[[:space:]]*$/\1=\2/p' .env)
fi

BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo ""
echo "${CYAN}==================================================${NC}"
echo "${CYAN}  测试工程师资讯平台 · 启动器${NC}"
echo "${CYAN}  项目目录: ${PROJECT_DIR}${NC}"
echo "${CYAN}==================================================${NC}"

# --- 检查 node / npm ----------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "${RED}❌ 未检测到 node，请先安装 Node.js (https://nodejs.org)${NC}"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "${RED}❌ 未检测到 npm${NC}"
  exit 1
fi
echo "${GREEN}✓${NC} node $(node -v) / npm $(npm -v)"

# --- 端口占用检测：若 5173 已在运行，说明已有实例，直接复用，避免多实例竞争 ---
if lsof -ti tcp:5173 >/dev/null 2>&1; then
  echo "${YELLOW}⚠️  5173 端口已被占用，可能已有实例在运行。${NC}"
  echo "${CYAN}>> 直接打开已有服务，不再启动新实例（多实例会导致文章重复 / 数据竞争）。${NC}"
  sleep 1
  open "http://localhost:5173/#/login" 2>/dev/null || true
  exit 0
fi

# --- 选择翻译/改写引擎 --------------------------------------------------------
echo ""
echo "${BOLD}请选择翻译 / 改写引擎：${NC}"
echo "  ${YELLOW}1)${NC} 公共在线翻译（零配置，但国内网络下可能不可用）"
echo "  ${GREEN}2)${NC} 本地 Ollama（推荐，完全免费且稳定，首次约 2GB，之后离线可用）"
echo ""
read -p "输入 1 或 2（直接回车 = 2）: " CHOICE
CHOICE="${CHOICE:-2}"

export LOCAL_LLM_URL=""
export LOCAL_LLM_MODEL="qwen2.5:3b"
export DISABLE_FREE_TRANSLATE=""

if [ "$CHOICE" = "2" ]; then
  echo ""
  echo "${CYAN}>> 准备启用本地大模型模式...${NC}"

  # 检测 Homebrew
  if ! command -v brew >/dev/null 2>&1; then
    echo "${RED}❌ 未安装 Homebrew，请先安装：https://brew.sh${NC}"
    exit 1
  fi

  # 检测 / 安装 Ollama
  if ! command -v ollama >/dev/null 2>&1; then
    echo "${CYAN}>> 未检测到 Ollama，通过 brew 安装...${NC}"
    brew install ollama
  else
    echo "${GREEN}✓${NC} 已安装 Ollama ($(ollama --version 2>/dev/null || echo unknown))"
  fi

  # 启动 Ollama 服务（后台），若尚未运行
  if ! curl -s --max-time 3 http://localhost:11434/api/tags >/dev/null 2>&1; then
    echo "${CYAN}>> 启动 Ollama 服务（后台）...${NC}"
    ollama serve >/tmp/ollama.log 2>&1 &
    for i in $(seq 1 30); do
      if curl -s --max-time 3 http://localhost:11434/api/tags >/dev/null 2>&1; then break; fi
      sleep 1
    done
  else
    echo "${GREEN}✓${NC} Ollama 服务已在运行"
  fi

  # 拉取模型（已存在则跳过）
  echo "${CYAN}>> 检查/拉取模型 qwen2.5:3b（首次约 2GB，请耐心等待）...${NC}"
  ollama pull qwen2.5:3b
  export LOCAL_LLM_URL="http://localhost:11434/v1"
  echo "${GREEN}✓ 本地大模型已就绪: ${LOCAL_LLM_URL}${NC}"
  echo "${GREEN}✓ 免费翻译已自动关闭（DISABLE_FREE_TRANSLATE=1）${NC}"
  export DISABLE_FREE_TRANSLATE="1"
else
  echo "${YELLOW}>> 公共在线翻译模式（受网络和第三方服务限制，建议优先使用本地模式）${NC}"
fi

# --- 安装依赖（如缺失）-------------------------------------------------------
if [ ! -d "node_modules" ]; then
  echo "${CYAN}>> 首次安装依赖...${NC}"
  npm install
fi

# --- 启动开发服务 -------------------------------------------------------------
echo ""
echo "${CYAN}==================================================${NC}"
echo "${CYAN}  启动开发服务 (npm run dev) ...${NC}"
echo "  完成后在浏览器打开 ${BOLD}http://localhost:5173/#/login${NC}"
echo "  账号 ${BOLD}admin-demo / 1234567890${NC}"
echo "  ${YELLOW}按 Ctrl+C 停止服务${NC}"
echo "${CYAN}==================================================${NC}"
echo ""

npm run dev
