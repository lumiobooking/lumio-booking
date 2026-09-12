#!/usr/bin/env sh
# Chạy ĐÚNG hai suite đã làm đỏ build 3 lần, trước khi push.
#   sh check-theme.sh
# Xanh hết thì push. Đỏ thì log in ra ngay danh sách chỗ sai màu.
set -e
cd "$(dirname "$0")/apps/web"
echo "== theme + theme-lint (web) =="
npx jest src/lib/theme-lint.spec.ts src/lib/theme.spec.ts src/components/hook-order.spec.ts
echo
echo "== xong. Xanh hết thì push duoc. =="
