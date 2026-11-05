import { useEffect, useState } from 'react';
import {
  BrowserProvider,
  Contract,
  JsonRpcSigner,
  formatEther,
  parseEther,
} from 'ethers';
import {
  ERC20_ABI,
  MINIDEX_ABI,
  MINIDEX_ADDRESS,
  TOKEN_A_ADDRESS,
  TOKEN_B_ADDRESS,
} from './contracts';
import './App.css';

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on(event: string, listener: (...args: any[]) => void): void;
  removeListener(event: string, listener: (...args: any[]) => void): void;
}

interface PoolData {
  reserveA: bigint;
  reserveB: bigint;
  totalShares: bigint;
}

interface PositionData {
  tokenId: bigint;
  poolId: bigint;
  shares: bigint;
  amountA: bigint;
  amountB: bigint;
  createdTimestamp: bigint;
}

interface LiquiditySource extends PositionData {
  owner: string;
}

interface Notice {
  type: 'info' | 'success' | 'error';
  text: string;
}

function getEthereum(): EthereumProvider | undefined {
  return (window as Window & { ethereum?: EthereumProvider }).ethereum;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatAmount(value: bigint) {
  return Number(formatEther(value)).toLocaleString('en-US', {
    maximumFractionDigits: 6,
  });
}

function parseAmount(value: string, label: string) {
  if (!value || Number(value) <= 0) {
    throw new Error(`请输入有效的${label}数量`);
  }
  return parseEther(value);
}

function slippageBasisPoints(value: string) {
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < 0 || percent > 50) {
    throw new Error('滑点应在 0% 到 50% 之间');
  }
  return BigInt(Math.round(percent * 100));
}

function applySlippage(amount: bigint, basisPoints: bigint) {
  return amount * (10000n - basisPoints) / 10000n;
}

function liquidityAmounts(
  pool: PoolData,
  desiredA: bigint,
  desiredB: bigint,
) {
  if (pool.totalShares === 0n) {
    return { amountA: desiredA, amountB: desiredB };
  }
  const optimalB = desiredA * pool.reserveB / pool.reserveA;
  if (optimalB <= desiredB) {
    return { amountA: desiredA, amountB: optimalB };
  }
  return {
    amountA: desiredB * pool.reserveA / pool.reserveB,
    amountB: desiredB,
  };
}

function errorMessage(error: unknown) {
  const walletError = error as {
    shortMessage?: string;
    reason?: string;
    message?: string;
  };
  return walletError.reason ?? walletError.shortMessage ?? walletError.message ?? '操作失败';
}

async function ensureLocalNetwork(ethereum: EthereumProvider) {
  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x7a69' }],
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) {
      throw error;
    }
    await ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: '0x7a69',
        chainName: 'Hardhat Localhost',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['http://127.0.0.1:8545'],
      }],
    });
  }
}

function App() {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [account, setAccount] = useState('');
  const [pool, setPool] = useState<PoolData | null>(null);
  const [balanceA, setBalanceA] = useState(0n);
  const [balanceB, setBalanceB] = useState(0n);
  const [positions, setPositions] = useState<PositionData[]>([]);
  const [liquiditySources, setLiquiditySources] = useState<LiquiditySource[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [addA, setAddA] = useState('100');
  const [addB, setAddB] = useState('200');
  const [swapAmount, setSwapAmount] = useState('100');
  const [swapDirection, setSwapDirection] = useState<'AtoB' | 'BtoA'>('AtoB');
  const [slippage, setSlippage] = useState('1');

  useEffect(() => {
    const ethereum = getEthereum();
    if (!ethereum) return;
    const reload = () => window.location.reload();
    ethereum.on('accountsChanged', reload);
    ethereum.on('chainChanged', reload);
    return () => {
      ethereum.removeListener('accountsChanged', reload);
      ethereum.removeListener('chainChanged', reload);
    };
  }, []);

  async function refreshData(
    readProvider: BrowserProvider | null = provider,
    ownerAddress: string = account,
  ) {
    if (!readProvider) return;
    const dex = new Contract(MINIDEX_ADDRESS, MINIDEX_ABI, readProvider);
    const poolCount = await dex.poolCount();
    if (poolCount > 0n) {
      const data = await dex.getPool(0);
      setPool({
        reserveA: data.reserveA,
        reserveB: data.reserveB,
        totalShares: data.totalShares,
      });
    } else {
      setPool(null);
    }

    if (!ownerAddress) {
      setLiquiditySources([]);
      return;
    }
    const tokenA = new Contract(TOKEN_A_ADDRESS, ERC20_ABI, readProvider);
    const tokenB = new Contract(TOKEN_B_ADDRESS, ERC20_ABI, readProvider);
    const [nextBalanceA, nextBalanceB, transferLogs] = await Promise.all([
      tokenA.balanceOf(ownerAddress),
      tokenB.balanceOf(ownerAddress),
      dex.queryFilter(dex.filters.Transfer(), 0, 'latest'),
    ]);
    setBalanceA(nextBalanceA);
    setBalanceB(nextBalanceB);

    const tokenIds = new Set<string>();
    for (const log of transferLogs) {
      if ('args' in log) tokenIds.add(log.args.tokenId.toString());
    }
    const ownedPositions: PositionData[] = [];
    const allPositions: LiquiditySource[] = [];
    for (const tokenId of tokenIds) {
      try {
        const owner = await dex.ownerOf(tokenId);
        const position = await dex.positions(tokenId);
        const data = {
          tokenId: BigInt(tokenId),
          poolId: position.poolId,
          shares: position.shares,
          amountA: position.amountA,
          amountB: position.amountB,
          createdTimestamp: position.createdTimestamp,
        };
        allPositions.push({ ...data, owner });
        if (owner.toLowerCase() === ownerAddress.toLowerCase()) {
          ownedPositions.push(data);
        }
      } catch {
        // Burned NFTs no longer have an owner.
      }
    }
    const byTokenId = (a: PositionData, b: PositionData) => a.tokenId < b.tokenId ? -1 : 1;
    setPositions(ownedPositions.sort(byTokenId));
    setLiquiditySources(allPositions.sort(byTokenId));
  }

  async function connectWallet() {
    const ethereum = getEthereum();
    if (!ethereum) {
      setNotice({ type: 'error', text: '请先安装 MetaMask 浏览器扩展' });
      return;
    }
    setBusy(true);
    setNotice({ type: 'info', text: '请在 MetaMask 中确认连接' });
    try {
      await ethereum.request({ method: 'eth_requestAccounts' });
      await ensureLocalNetwork(ethereum);
      const browserProvider = new BrowserProvider(ethereum);
      const walletSigner = await browserProvider.getSigner();
      const address = await walletSigner.getAddress();
      setProvider(browserProvider);
      setSigner(walletSigner);
      setAccount(address);
      await refreshData(browserProvider, address);
      setNotice({ type: 'success', text: '钱包已连接，数据已从本地链读取' });
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  function requireSigner() {
    if (!signer) throw new Error('请先连接钱包');
    return signer;
  }

  async function ensureAllowance(tokenAddress: string, amount: bigint) {
    const token = new Contract(tokenAddress, ERC20_ABI, requireSigner());
    const current = await token.allowance(account, MINIDEX_ADDRESS);
    if (current < amount) {
      await (await token.approve(MINIDEX_ADDRESS, amount)).wait();
    }
  }

  async function runAction(successText: string, action: () => Promise<void>) {
    setBusy(true);
    setNotice({ type: 'info', text: '请在钱包中确认，并等待交易上链…' });
    try {
      await action();
      await refreshData();
      setNotice({ type: 'success', text: successText });
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  function claimToken(tokenAddress: string, symbol: string) {
    return runAction(`已领取 1000 ${symbol}`, async () => {
      const token = new Contract(tokenAddress, ERC20_ABI, requireSigner());
      await (await token.faucet()).wait();
    });
  }

  function createPool() {
    return runAction('TKA/TKB 池子创建成功', async () => {
      const dex = new Contract(MINIDEX_ADDRESS, MINIDEX_ABI, requireSigner());
      await (await dex.createPool(TOKEN_A_ADDRESS, TOKEN_B_ADDRESS)).wait();
    });
  }

  function addLiquidity() {
    return runAction('注资成功，新的 LP NFT 已发放', async () => {
      if (!pool) throw new Error('请先创建池子');
      const desiredA = parseAmount(addA, 'TKA');
      const desiredB = parseAmount(addB, 'TKB');
      const { amountA, amountB } = liquidityAmounts(pool, desiredA, desiredB);
      if (amountA === 0n || amountB === 0n) throw new Error('投入数量过小');
      const minimum = slippageBasisPoints(slippage);
      await ensureAllowance(TOKEN_A_ADDRESS, amountA);
      await ensureAllowance(TOKEN_B_ADDRESS, amountB);
      const dex = new Contract(MINIDEX_ADDRESS, MINIDEX_ABI, requireSigner());
      await (await dex.addLiquidity(
        0,
        desiredA,
        desiredB,
        applySlippage(amountA, minimum),
        applySlippage(amountB, minimum),
      )).wait();
    });
  }

  function swapQuote() {
    try {
      if (!pool || pool.totalShares === 0n || !swapAmount || Number(swapAmount) <= 0) {
        return 0n;
      }
      const amountIn = parseEther(swapAmount);
      const reserveIn = swapDirection === 'AtoB' ? pool.reserveA : pool.reserveB;
      const reserveOut = swapDirection === 'AtoB' ? pool.reserveB : pool.reserveA;
      const effectiveInput = amountIn * 997n / 1000n;
      return effectiveInput * reserveOut / (reserveIn + effectiveInput);
    } catch {
      return 0n;
    }
  }

  function swap() {
    return runAction('交换成功，余额和池子储备已更新', async () => {
      if (!pool) throw new Error('请先创建并注资池子');
      const amountIn = parseAmount(swapAmount, '交换');
      const quotedOutput = swapQuote();
      if (quotedOutput === 0n) throw new Error('当前无法计算有效输出');
      const tokenIn = swapDirection === 'AtoB' ? TOKEN_A_ADDRESS : TOKEN_B_ADDRESS;
      await ensureAllowance(tokenIn, amountIn);
      const minimum = applySlippage(quotedOutput, slippageBasisPoints(slippage));
      const dex = new Contract(MINIDEX_ADDRESS, MINIDEX_ABI, requireSigner());
      await (await dex.swapExactInput(0, tokenIn, amountIn, minimum)).wait();
    });
  }

  function redeem(position: PositionData) {
    return runAction(`LP NFT #${position.tokenId} 已赎回`, async () => {
      if (!pool || pool.totalShares === 0n) throw new Error('池子状态无效');
      const amountA = position.shares * pool.reserveA / pool.totalShares;
      const amountB = position.shares * pool.reserveB / pool.totalShares;
      const minimum = slippageBasisPoints(slippage);
      const dex = new Contract(MINIDEX_ADDRESS, MINIDEX_ABI, requireSigner());
      await (await dex.removeLiquidity(
        position.tokenId,
        applySlippage(amountA, minimum),
        applySlippage(amountB, minimum),
      )).wait();
    });
  }

  const quotedOutput = swapQuote();
  const inputSymbol = swapDirection === 'AtoB' ? 'TKA' : 'TKB';
  const outputSymbol = swapDirection === 'AtoB' ? 'TKB' : 'TKA';
  const price = pool && pool.reserveA > 0n
    ? Number(formatEther(pool.reserveB)) / Number(formatEther(pool.reserveA))
    : 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div><strong>MiniDEX</strong><span>恒定乘积交易平台</span></div>
        </div>
        <button className="connect-button" onClick={connectWallet} disabled={busy}>
          {account ? shortAddress(account) : busy ? '处理中…' : '连接 MetaMask'}
        </button>
      </header>

      <main>
        <section className="hero">
          <span className="eyebrow">LOCAL HARDHAT · CHAIN ID 31337</span>
          <h1>用两种测试币，体验完整的 AMM 流程</h1>
          <p>建池、提供流动性、交换代币，并通过 LP NFT 赎回资产。</p>
        </section>

        {notice && <div className={`notice ${notice.type}`} role="status">{notice.text}</div>}

        <section className="stats-grid">
          <article className="stat-card">
            <span>我的 TKA</span><strong>{formatAmount(balanceA)}</strong>
            <button onClick={() => claimToken(TOKEN_A_ADDRESS, 'TKA')} disabled={busy || !account}>领取 1000 TKA</button>
          </article>
          <article className="stat-card">
            <span>我的 TKB</span><strong>{formatAmount(balanceB)}</strong>
            <button onClick={() => claimToken(TOKEN_B_ADDRESS, 'TKB')} disabled={busy || !account}>领取 1000 TKB</button>
          </article>
          <article className="stat-card">
            <span>池子价格</span><strong>{price ? price.toFixed(4) : '—'}</strong>
            <small>TKB / TKA</small>
          </article>
        </section>

        <div className="main-grid">
          <section className="panel pool-panel">
            <div className="panel-heading"><span>01</span><h2>交易池</h2></div>
            {pool ? (
              <>
                <div className="pool-name">TKA / TKB <span>0.3% 手续费</span></div>
                <div className="reserve-row"><span>TKA 储备</span><strong>{formatAmount(pool.reserveA)}</strong></div>
                <div className="reserve-row"><span>TKB 储备</span><strong>{formatAmount(pool.reserveB)}</strong></div>
                <div className="reserve-row"><span>LP 总份额</span><strong>{formatAmount(pool.totalShares)}</strong></div>
                {liquiditySources.length > 0 && (
                  <div className="sources">
                    <span>流动性来源</span>
                    {liquiditySources.map((position) => (
                      <div key={position.tokenId.toString()}>
                        <span>#{position.tokenId.toString()} {shortAddress(position.owner)}</span>
                        <strong>{formatAmount(position.shares)} 份额</strong>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state">
                <p>当前还没有 TKA/TKB 池子。</p>
                <button onClick={createPool} disabled={busy || !account}>创建交易池</button>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading"><span>02</span><h2>提供流动性</h2></div>
            <label>投入 TKA<input value={addA} onChange={(event) => setAddA(event.target.value)} inputMode="decimal" /></label>
            <label>投入 TKB<input value={addB} onChange={(event) => setAddB(event.target.value)} inputMode="decimal" /></label>
            <p className="hint">后续注资会按池子当前比例自动调整实际投入。</p>
            <button className="primary-action" onClick={addLiquidity} disabled={busy || !account || !pool}>授权并注资</button>
          </section>

          <section className="panel swap-panel">
            <div className="panel-heading"><span>03</span><h2>交换</h2></div>
            <label>支付<input type="number" min="0" value={swapAmount} onChange={(event) => setSwapAmount(event.target.value)} /></label>
            <div className="direction-row">
              <button className={swapDirection === 'AtoB' ? 'selected' : ''} onClick={() => setSwapDirection('AtoB')}>TKA → TKB</button>
              <button className={swapDirection === 'BtoA' ? 'selected' : ''} onClick={() => setSwapDirection('BtoA')}>TKB → TKA</button>
            </div>
            <div className="quote-box">
              <span>预计收到</span>
              <strong>{formatAmount(quotedOutput)} {outputSymbol}</strong>
              <small>{swapAmount || '0'} {inputSymbol} · 已计 0.3% 手续费</small>
            </div>
            <button className="primary-action" onClick={swap} disabled={busy || !account || !pool || quotedOutput === 0n}>授权并交换</button>
          </section>

          <section className="panel positions-panel">
            <div className="panel-heading"><span>04</span><h2>我的 LP NFT</h2></div>
            {positions.length === 0 ? (
              <p className="hint">暂无持仓。提供流动性后，仓位会显示在这里。</p>
            ) : (
              <div className="position-list">
                {positions.map((position) => (
                  <div className="position-card" key={position.tokenId.toString()}>
                    <div>
                      <strong>LP NFT #{position.tokenId.toString()}</strong>
                      <span>池子 #{position.poolId.toString()}</span>
                      <span>投入 {formatAmount(position.amountA)} TKA + {formatAmount(position.amountB)} TKB</span>
                      <span>{new Date(Number(position.createdTimestamp) * 1000).toLocaleString()}</span>
                    </div>
                    <div><span>份额</span><strong>{formatAmount(position.shares)}</strong></div>
                    <button onClick={() => redeem(position)} disabled={busy}>赎回两种代币</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="settings panel">
          <label>滑点保护（%）<input value={slippage} onChange={(event) => setSlippage(event.target.value)} inputMode="decimal" /></label>
          <p>实际所得低于滑点保护允许的最小值时，交易会回滚。</p>
        </section>

        <footer>
          <span>TKA {TOKEN_A_ADDRESS}</span>
          <span>TKB {TOKEN_B_ADDRESS}</span>
          <span>MiniDEX {MINIDEX_ADDRESS}</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
