import assert from "node:assert/strict";
import hre from "hardhat";

function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number) {
  for (let index = items.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
  return items;
}

async function main() {
  const { ethers } = await hre.network.connect();
  const signers = await ethers.getSigners();
  assert.ok(signers.length >= 21, "The local node must provide at least 21 accounts");
  const [provider, ...users] = signers.slice(0, 21);
  const random = createRandom(Number(process.env.SIMULATION_SEED ?? 2026));
  const randomInt = (minimum: number, maximum: number) =>
    Math.floor(random() * (maximum - minimum + 1)) + minimum;

  const tokenA = await ethers.deployContract("TestToken", ["Test Token A", "TKA"]);
  const tokenB = await ethers.deployContract("TestToken", ["Test Token B", "TKB"]);
  const miniDEX = await ethers.deployContract("MiniDEX");
  await Promise.all([
    tokenA.waitForDeployment(),
    tokenB.waitForDeployment(),
    miniDEX.waitForDeployment(),
  ]);
  const tokenAAddress = await tokenA.getAddress();
  const tokenBAddress = await tokenB.getAddress();
  const dexAddress = await miniDEX.getAddress();
  await (await miniDEX.createPool(tokenAAddress, tokenBAddress)).wait();
  await (await tokenA.approve(dexAddress, ethers.MaxUint256)).wait();
  await (await tokenB.approve(dexAddress, ethers.MaxUint256)).wait();
  await (
    await miniDEX.addLiquidity(
      0,
      ethers.parseEther("10000"),
      ethers.parseEther("20000"),
      0,
      0,
    )
  ).wait();
  console.log("✓ 初始池子已建立：10000 TKA + 20000 TKB");

  const positionOwners = new Map<bigint, string>();
  let nextTokenId = 2n;
  for (const [index, user] of users.entries()) {
    const userAddress = await user.getAddress();
    await (await tokenA.connect(user).faucet()).wait();
    await (await tokenB.connect(user).faucet()).wait();
    await (await tokenA.connect(user).approve(dexAddress, ethers.MaxUint256)).wait();
    await (await tokenB.connect(user).approve(dexAddress, ethers.MaxUint256)).wait();

    const pool = await miniDEX.getPool(0);
    const amountA = ethers.parseEther(randomInt(10, 30).toString());
    const amountBDesired = amountA * pool.reserveB / pool.reserveA + ethers.parseEther("1");
    await (
      await miniDEX.connect(user).addLiquidity(0, amountA, amountBDesired, 0, 0)
    ).wait();
    positionOwners.set(nextTokenId, userAddress);
    assert.equal(await miniDEX.ownerOf(nextTokenId), userAddress);
    nextTokenId++;

    const updatedPool = await miniDEX.getPool(0);
    assert.equal(await tokenA.balanceOf(dexAddress), updatedPool.reserveA);
    assert.equal(await tokenB.balanceOf(dexAddress), updatedPool.reserveB);
    console.log(`✓ 用户 ${index + 1}: 注资 ${ethers.formatEther(amountA)} TKA，获得 LP NFT`);
  }

  let successfulSwaps = 0;
  for (const user of shuffle([...users], random)) {
    const pool = await miniDEX.getPool(0);
    const swapAForB = random() < 0.5;
    const tokenIn = swapAForB ? tokenA : tokenB;
    const tokenInAddress = swapAForB ? tokenAAddress : tokenBAddress;
    const amountIn = ethers.parseEther(randomInt(1, 10).toString());
    const reserveIn = swapAForB ? pool.reserveA : pool.reserveB;
    const reserveOut = swapAForB ? pool.reserveB : pool.reserveA;
    const effectiveInput = amountIn * 997n / 1000n;
    const expectedOutput = effectiveInput * reserveOut / (reserveIn + effectiveInput);
    const kBefore = pool.reserveA * pool.reserveB;

    await (
      await miniDEX.connect(user).swapExactInput(0, tokenInAddress, amountIn, expectedOutput)
    ).wait();
    const updatedPool = await miniDEX.getPool(0);
    assert.ok(updatedPool.reserveA * updatedPool.reserveB >= kBefore);
    assert.equal(await tokenA.balanceOf(dexAddress), updatedPool.reserveA);
    assert.equal(await tokenB.balanceOf(dexAddress), updatedPool.reserveB);
    successfulSwaps++;
  }
  console.log(`✓ 20 个用户按随机方向和随机数量完成 ${successfulSwaps} 次交换`);

  const userPositions = [...positionOwners.entries()];
  shuffle(userPositions, random);
  for (const [tokenId, ownerAddress] of userPositions) {
    const ownerIndex = users.findIndex((user) => user.address === ownerAddress);
    assert.notEqual(ownerIndex, -1);
    await (await miniDEX.connect(users[ownerIndex]).removeLiquidity(tokenId, 0, 0)).wait();
    assert.equal(await miniDEX.balanceOf(ownerAddress), 0n);
    positionOwners.delete(tokenId);

    const pool = await miniDEX.getPool(0);
    assert.equal(await tokenA.balanceOf(dexAddress), pool.reserveA);
    assert.equal(await tokenB.balanceOf(dexAddress), pool.reserveB);
  }
  console.log("✓ 20 个用户已按随机顺序赎回并销毁各自的 LP NFT");

  await (await miniDEX.removeLiquidity(1, 0, 0)).wait();
  const finalPool = await miniDEX.getPool(0);
  assert.equal(finalPool.reserveA, 0n);
  assert.equal(finalPool.reserveB, 0n);
  assert.equal(finalPool.totalShares, 0n);
  assert.equal(positionOwners.size, 0);
  assert.equal(await tokenA.balanceOf(dexAddress), 0n);
  assert.equal(await tokenB.balanceOf(dexAddress), 0n);

  const allAccounts = await Promise.all(signers.slice(0, 21).map((user) => user.getAddress()));
  for (const token of [tokenA, tokenB]) {
    const balances = await Promise.all(
      allAccounts.map((account) => token.balanceOf(account)),
    );
    const accountedSupply = balances.reduce((sum, balance) => sum + balance, 0n);
    assert.equal(accountedSupply, await token.totalSupply());
  }
  console.log("✓ 最终储备、LP 总份额和 DEX 代币余额均归零");
  console.log("✓ 两种代币的账户余额总和均等于链上总供应量");
  console.log(`\n20 用户随机模拟通过（seed=${process.env.SIMULATION_SEED ?? 2026}）`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
