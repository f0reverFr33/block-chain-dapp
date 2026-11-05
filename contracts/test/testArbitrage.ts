import { expect } from "chai";
import hre from "hardhat";

const { ethers, networkHelpers } = await hre.network.create();

function quote(amountIn: bigint, reserveIn: bigint, reserveOut: bigint) {
  const effectiveInput = amountIn * 997n / 1000n;
  return effectiveInput * reserveOut / (reserveIn + effectiveInput);
}

describe("AtomicArbitrage", function () {
  async function arbitrageFixture() {
    const [owner, trader] = await ethers.getSigners();
    const tokenA = await ethers.deployContract("TestToken", ["Test Token A", "TKA"]);
    const tokenB = await ethers.deployContract("TestToken", ["Test Token B", "TKB"]);
    const buyDex = await ethers.deployContract("MiniDEX");
    const sellDex = await ethers.deployContract("MiniDEX");
    const arbitrage = await ethers.deployContract("AtomicArbitrage");
    await Promise.all([
      tokenA.waitForDeployment(),
      tokenB.waitForDeployment(),
      buyDex.waitForDeployment(),
      sellDex.waitForDeployment(),
      arbitrage.waitForDeployment(),
    ]);

    const tokenAAddress = await tokenA.getAddress();
    const tokenBAddress = await tokenB.getAddress();
    await buyDex.createPool(tokenAAddress, tokenBAddress);
    await sellDex.createPool(tokenAAddress, tokenBAddress);
    await tokenA.approve(await buyDex.getAddress(), ethers.MaxUint256);
    await tokenB.approve(await buyDex.getAddress(), ethers.MaxUint256);
    await tokenA.approve(await sellDex.getAddress(), ethers.MaxUint256);
    await tokenB.approve(await sellDex.getAddress(), ethers.MaxUint256);
    await buyDex.addLiquidity(
      0,
      ethers.parseEther("1000"),
      ethers.parseEther("3000"),
      0,
      0,
    );
    await sellDex.addLiquidity(
      0,
      ethers.parseEther("3000"),
      ethers.parseEther("1000"),
      0,
      0,
    );
    await tokenA.connect(trader).faucet();

    return {
      tokenA,
      tokenB,
      buyDex,
      sellDex,
      arbitrage,
      owner,
      trader,
      tokenAAddress,
      tokenBAddress,
    };
  }

  it("executes both swaps atomically and pays the profit to the trader", async function () {
    const {
      tokenA,
      tokenB,
      buyDex,
      sellDex,
      arbitrage,
      trader,
      tokenAAddress,
      tokenBAddress,
    } = await networkHelpers.loadFixture(arbitrageFixture);
    const traderAddress = await trader.getAddress();
    const amountIn = ethers.parseEther("100");
    const amountB = quote(
      amountIn,
      ethers.parseEther("1000"),
      ethers.parseEther("3000"),
    );
    const amountOut = quote(
      amountB,
      ethers.parseEther("1000"),
      ethers.parseEther("3000"),
    );
    const expectedProfit = amountOut - amountIn;
    await tokenA.connect(trader).approve(await arbitrage.getAddress(), amountIn);

    await expect(
      arbitrage.connect(trader).arbitrage({
        buyDex: await buyDex.getAddress(),
        sellDex: await sellDex.getAddress(),
        buyPoolId: 0,
        sellPoolId: 0,
        tokenA: tokenAAddress,
        tokenB: tokenBAddress,
        amountIn,
        minProfit: ethers.parseEther("1"),
      }),
    )
      .to.emit(arbitrage, "ArbitrageExecuted")
      .withArgs(traderAddress, amountIn, amountOut, expectedProfit);

    expect(await tokenA.balanceOf(traderAddress)).to.equal(
      ethers.parseEther("900") + amountOut,
    );
    expect(await tokenA.balanceOf(await arbitrage.getAddress())).to.equal(0);
    expect(await tokenB.balanceOf(await arbitrage.getAddress())).to.equal(0);
  });

  it("reverts an unprofitable route without changing balances or reserves", async function () {
    const {
      tokenA,
      tokenB,
      buyDex,
      sellDex,
      arbitrage,
      trader,
      tokenAAddress,
      tokenBAddress,
    } = await networkHelpers.loadFixture(arbitrageFixture);
    const traderAddress = await trader.getAddress();
    const arbitrageAddress = await arbitrage.getAddress();
    const amountIn = ethers.parseEther("100");
    const buyPoolBefore = await buyDex.getPool(0);
    const sellPoolBefore = await sellDex.getPool(0);
    await tokenA.connect(trader).approve(arbitrageAddress, amountIn);

    await expect(
      arbitrage.connect(trader).arbitrage({
        buyDex: await sellDex.getAddress(),
        sellDex: await buyDex.getAddress(),
        buyPoolId: 0,
        sellPoolId: 0,
        tokenA: tokenAAddress,
        tokenB: tokenBAddress,
        amountIn,
        minProfit: 1,
      }),
    ).to.be.revertedWith("Arbitrage not profitable");

    expect(await tokenA.balanceOf(traderAddress)).to.equal(ethers.parseEther("1000"));
    expect(await tokenA.balanceOf(arbitrageAddress)).to.equal(0);
    expect(await tokenB.balanceOf(arbitrageAddress)).to.equal(0);
    expect((await buyDex.getPool(0)).reserveA).to.equal(buyPoolBefore.reserveA);
    expect((await buyDex.getPool(0)).reserveB).to.equal(buyPoolBefore.reserveB);
    expect((await sellDex.getPool(0)).reserveA).to.equal(sellPoolBefore.reserveA);
    expect((await sellDex.getPool(0)).reserveB).to.equal(sellPoolBefore.reserveB);
  });

  it("reverts when the profit is below the trader's minimum", async function () {
    const { tokenA, buyDex, sellDex, arbitrage, trader, tokenAAddress, tokenBAddress } =
      await networkHelpers.loadFixture(arbitrageFixture);
    const amountIn = ethers.parseEther("100");
    await tokenA.connect(trader).approve(await arbitrage.getAddress(), amountIn);

    await expect(
      arbitrage.connect(trader).arbitrage({
        buyDex: await buyDex.getAddress(),
        sellDex: await sellDex.getAddress(),
        buyPoolId: 0,
        sellPoolId: 0,
        tokenA: tokenAAddress,
        tokenB: tokenBAddress,
        amountIn,
        minProfit: ethers.MaxUint256,
      }),
    ).to.be.revertedWith("Arbitrage not profitable");
    expect(await tokenA.balanceOf(await trader.getAddress())).to.equal(
      ethers.parseEther("1000"),
    );
  });
});
