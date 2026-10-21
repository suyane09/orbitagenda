import { Component, type ReactNode } from 'react'
import { ErrorState } from '@/components/ui/States'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown) { console.error('Falha de renderização:', error) }
  render() {
    if (!this.state.failed) return this.props.children
    return <ErrorState title="Algo deu errado" message="A tela encontrou um erro inesperado. Recarregue a página; se continuar, entre em contato com o suporte."
      onRetry={() => window.location.reload()} />
  }
}
