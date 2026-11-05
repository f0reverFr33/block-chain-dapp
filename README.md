# MiniDEX：基于 AMM 的去中心化交易所

作者：陈元煦（3230104846）

## 如何运行

### 1. 准备环境

建议使用 Node.js 24，并在浏览器中安装 MetaMask。第一次运行时安装依赖：

```bash
cd contracts
npm ci

cd ../frontend
npm ci
```

### 2. 启动本地区块链

在项目根目录打开第一个终端：

```bash
cd contracts
npm run node
```

保持终端运行。节点地址为 `http://127.0.0.1:8545`，Chain ID 为 `31337`，提供 21 个带测试 ETH 的本地账户。

### 3. 部署合约

打开第二个终端：

```bash
cd contracts
npm run deploy
```

命令会依次部署 TKA、TKB 和 MiniDEX，并输出三个合约地址。

### 4. 启动前端

打开第三个终端：

```bash
cd frontend
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000)，点击“连接 MetaMask”，确认连接并切换或添加 Hardhat 本地网络。

前端默认使用**全新节点上第一次执行部署脚本**所得的地址。如果部署顺序不同，请根据部署输出创建 `frontend/.env.local`：

```dotenv
VITE_TOKEN_A_ADDRESS=TKA地址
VITE_TOKEN_B_ADDRESS=TKB地址
VITE_MINIDEX_ADDRESS=MiniDEX地址
```

修改后重启前端。每次重启本地节点都会清空链上状态，需要重新部署并刷新页面。

### 5. 页面操作

1. 点击“创建交易池”并确认交易。
2. 分别领取 TKA、TKB；每个地址、每种代币限领一次。
3. 输入两种代币数量，点击“授权并注资”，依次确认两次授权和一次注资。
4. 注资成功后，页面显示 LP NFT、流动性来源和池子储备。
5. 选择交换方向并输入数量，确认授权和交换。
6. 在“我的 LP NFT”中点击“赎回两种代币”，销毁 NFT 并取回资产。

请只使用 Hardhat 提供的测试账户，不要将真实账户私钥用于本地开发。

### 6. 测试与演示

单元测试和构建：

```bash
cd contracts
npm test
npm run typecheck

cd ../frontend
npm test
npm run build
```

保持本地节点运行，在 `contracts/` 中还可以执行：

```bash
npm run smoke       # 部署、建池、注资、交换、赎回的完整流程
npm run simulate    # 20 用户随机操作及账目一致性检查
npm run arbitrage   # Bonus：两个交易所之间的原子套利与失败回滚演示
```

## 功能实现分析

### 1. 测试代币

`TestToken.sol` 基于 OpenZeppelin ERC20 实现，初始总供应量为 1,000,000。每个地址可通过 `faucet` 领取 1,000 枚，并用 `hasClaimed` 保证每种币只领取一次，便于多人测试。

### 2. 交易池

`createPool` 将两种代币地址按大小排序后生成 pair key，因此 A/B 与 B/A 被视为同一个池子，重复建池会回滚。池子记录两种代币地址、双方储备、LP 总份额和创建时间。

### 3. 添加流动性

首次注资时按实际投入的两种代币数量计算份额：`sqrt(amountA * amountB)`。之后注资按当前储备比例调整实际投入，多余部分不会转走，份额沿用 Uniswap V2 的 `min` 规则计算。每次注资都会铸造一个 ERC721 仓位 NFT，记录所属池子、份额、实际投入和创建时间。

### 4. 交换

`swapExactInput` 采用恒定乘积公式，扣除 0.3% 手续费后计算输出：

```text
有效输入 = amountIn * 997 / 1000
amountOut = 有效输入 * reserveOut / (reserveIn + 有效输入)
```

函数同时检查池子存在、代币属于该池、输出大于零以及不低于调用者设置的最低输出。手续费留在池中，因此每笔交易后 `k` 只会增加不会减少，这部分收益归全体 LP 所有。

### 5. 赎回流动性

持有人调用 `removeLiquidity`，按份额占 LP 总份额的比例取回两种代币，比例中已包含累计手续费收益。合约先更新储备、减少总份额、删除仓位并销毁 NFT，然后才转账，配合 `nonReentrant` 防止重入。

### 6. Bonus：原子套利

`AtomicArbitrage.sol` 在一次交易内依次在低价交易所买入、在高价交易所卖出。若最终利润低于调用者设定的 `minProfit`，整笔交易回滚，用户的代币、两个池子的储备都不会留下中间状态。合约使用 `SafeERC20` 和 `ReentrancyGuard`。

## 项目运行截图

### 1. 前端首页

![MiniDEX 前端首页](docs/screenshots/frontend-home.png)

### 2. 连接 MetaMask 与测试代币

![连接 MetaMask 与测试代币余额](docs/screenshots/01-wallet-connected.png)

### 3. 创建交易池

![创建 TKA/TKB 交易池](docs/screenshots/02-create-pool.png)

### 4. 添加流动性并获得 LP NFT

![添加流动性并获得 LP NFT](docs/screenshots/03-add-liquidity.png)

### 5. TKA 兑换 TKB

![TKA 兑换 TKB](docs/screenshots/04-swap-a-to-b.png)

### 6. TKB 兑换 TKA

![TKB 兑换 TKA](docs/screenshots/05-swap-b-to-a.png)

### 7. 赎回流动性并销毁 LP NFT

![赎回流动性并销毁 LP NFT](docs/screenshots/06-remove-liquidity.png)

### 8. 20 个模拟用户

![20 个模拟用户及账目一致性检查](docs/screenshots/07-simulate-20-users.png)

### 9. Bonus：双交易所原子套利

![双交易所原子套利与失败回滚](docs/screenshots/08-atomic-arbitrage.png)

## 参考内容

- [Uniswap V2 文档](https://docs.uniswap.org/contracts/v2/overview)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)
- [Hardhat 文档](https://hardhat.org/docs)
- [ethers 文档](https://docs.ethers.org/v6/)
