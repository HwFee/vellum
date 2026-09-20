type ErrorStateProps = {
  message: string;
  path?: string;
  /// 「重新打开」按钮：由 App 传入打开文件对话框的回调
  onRetry?: () => void;
};

export function ErrorState({ message, path, onRetry }: ErrorStateProps) {
  return (
    <section className="error-state" role="alert">
      <div className="empty-eyebrow">文件错误</div>
      <h1>无法打开此 Markdown 文件</h1>
      <p>{message}</p>
      {path ? <code>{path}</code> : null}
      {onRetry ? (
        <button className="button button-primary" type="button" onClick={onRetry}>
          重新打开
        </button>
      ) : null}
    </section>
  );
}
