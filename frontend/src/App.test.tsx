import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the MiniDEX workspace and wallet connection', () => {
  render(<App />);
  expect(screen.getByText('MiniDEX')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '连接 MetaMask' })).toBeInTheDocument();
  expect(screen.getByText('提供流动性')).toBeInTheDocument();
  expect(screen.getByText('我的 LP NFT')).toBeInTheDocument();
});
