'use client';

/**
 * A fence around one panel of a screen.
 *
 * WHY THIS EXISTS
 *
 * `/salon/content` is nine tabs of independent panels sharing one page-level
 * error boundary. That boundary works — it prints the real message and stack,
 * which is more than most apps manage — but it replaces the WHOLE SCREEN. One
 * panel reading a field the API has not shipped yet takes down the ideas, the
 * calendar, the queue and the post scheduler with it, and the person is left
 * with a stack trace where their work used to be.
 *
 * That is the wrong blast radius. A panel that cannot render is a broken panel,
 * not a broken page. This catches it, says which panel and why in a card the
 * size of the panel, and leaves every other tab working.
 *
 * The message is shown, not swallowed. A card reading "something went wrong"
 * teaches the person that the software is unreliable and teaches us nothing;
 * the real error text in a screenshot is the diagnosis.
 */

import { Component, type ReactNode } from 'react';

interface Props { name: string; children: ReactNode }
interface State { error: Error | null }

export class Panel extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Kept for the browser console, where a developer looking over someone's
    // shoulder expects to find it.
    console.error(`[panel:${this.props.name}]`, error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{
        border: '1px solid #ef4444', background: 'rgba(239,68,68,.08)',
        borderRadius: 12, padding: 16, color: '#e2e8f0',
      }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: '#ef4444' }}>
          Phần “{this.props.name}” không hiển thị được
        </div>
        <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6, marginTop: 5 }}>
          Các phần khác của trang vẫn dùng bình thường. Thường gặp nhất là giao diện vừa cập nhật
          xong mà máy chủ chưa xong — đợi vài phút rồi tải lại. Nếu vẫn vậy, chụp màn hình này gửi đội Lumio.
        </div>
        <pre style={{
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11.5, lineHeight: 1.5,
          background: '#0f172a', border: '1px solid #334155', borderRadius: 9,
          padding: 11, marginTop: 11, maxHeight: 160, overflow: 'auto', color: '#fbbf24',
        }}>{String(error.message || error)}</pre>
        <button
          onClick={() => this.setState({ error: null })}
          style={{
            marginTop: 11, padding: '8px 14px', borderRadius: 9, cursor: 'pointer',
            border: '1px solid #334155', background: 'transparent', color: '#e2e8f0',
            fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
          }}
        >Thử lại phần này</button>
      </div>
    );
  }
}
