import { Component } from 'react';
import t from '../i18n/he.json';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Send error to backend log endpoint
    const payload = {
      level: 'error',
      message: error?.message || String(error),
      stack: info?.componentStack || error?.stack || '',
    };

    fetch('/api/system/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {
      // Silently fail if backend is unreachable
    });
  }

  handleRefresh = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="w-[1920px] h-[1080px] flex flex-col items-center justify-center bg-bg gap-6"
          dir="rtl"
        >
          <div className="text-6xl mb-2">:(</div>
          <h1 className="text-3xl font-bold text-tp">
            {t.errorBoundary.title}
          </h1>
          <p className="text-lg text-ts max-w-md text-center">
            {t.errorBoundary.description}
          </p>
          <button
            onClick={this.handleRefresh}
            className="mt-4 px-8 py-3 bg-acc text-white rounded-xl font-medium text-lg
                       hover:bg-acc/90 active:scale-95 transition-all"
          >
            {t.errorBoundary.refresh}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
