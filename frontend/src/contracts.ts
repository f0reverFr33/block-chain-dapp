export const TOKEN_A_ADDRESS =
  import.meta.env.VITE_TOKEN_A_ADDRESS ?? '0x5FbDB2315678afecb367f032d93F642f64180aa3';
export const TOKEN_B_ADDRESS =
  import.meta.env.VITE_TOKEN_B_ADDRESS ?? '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
export const MINIDEX_ADDRESS =
  import.meta.env.VITE_MINIDEX_ADDRESS ?? '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';

export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function faucet()',
];

export const MINIDEX_ABI = [
  'function poolCount() view returns (uint256)',
  'function getPool(uint256 poolId) view returns (tuple(address tokenA, address tokenB, uint256 reserveA, uint256 reserveB, uint256 totalShares, uint256 createdTimestamp))',
  'function createPool(address tokenA, address tokenB) returns (uint256 poolId)',
  'function addLiquidity(uint256 poolId, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin) returns (uint256 tokenId, uint256 shares)',
  'function swapExactInput(uint256 poolId, address tokenIn, uint256 amountIn, uint256 minAmountOut) returns (uint256 amountOut)',
  'function removeLiquidity(uint256 tokenId, uint256 minAmountA, uint256 minAmountB) returns (uint256 amountA, uint256 amountB)',
  'function positions(uint256 tokenId) view returns (uint256 poolId, uint256 shares, uint256 amountA, uint256 amountB, uint256 createdTimestamp)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];
