import { expect } from "chai";
import hre from "hardhat";

const { ethers, networkHelpers } = await hre.network.create();

describe("MiniDEX", function () {
  async function deployFixture() {
    const [owner, otherAccount] = await ethers.getSigners();
    const miniDEX = await ethers.deployContract("MiniDEX");
    await miniDEX.waitForDeployment();

    return { miniDEX, owner, otherAccount };
  }

  async function deployWithTokensFixture() {
    const base = await deployFixture();
    const tokenA = await ethers.deployContract("TestToken", ["Test Token A", "TKA"]);
    const tokenB = await ethers.deployContract("TestToken", ["Test Token B", "TKB"]);
    await tokenA.waitForDeployment();
    await tokenB.waitForDeployment();

    return { ...base, tokenA, tokenB };
  }

  async function createPoolFixture() {
    const base = await deployWithTokensFixture();
    await base.miniDEX.createPool(
      await base.tokenA.getAddress(),
      await base.tokenB.getAddress(),
    );
    return base;
  }

  async function initializedPoolFixture() {
    const base = await createPoolFixture();
    const initialA = ethers.parseEther("1000");
    const initialB = ethers.parseEther("2000");
    const dexAddress = await base.miniDEX.getAddress();

    await base.tokenA.approve(dexAddress, initialA);
    await base.tokenB.approve(dexAddress, initialB);
    await base.miniDEX.addLiquidity(0, initialA, initialB, initialA, initialB);

    return { ...base, initialA, initialB };
  }

  describe("Pool creation", function () {
    it("creates an empty pool and records its token pair", async function () {
      const { miniDEX, tokenA, tokenB } =
        await networkHelpers.loadFixture(deployWithTokensFixture);
      const tokenAAddress = await tokenA.getAddress();
      const tokenBAddress = await tokenB.getAddress();

      await expect(miniDEX.createPool(tokenAAddress, tokenBAddress))
        .to.emit(miniDEX, "PoolCreated")
        .withArgs(0, tokenAAddress, tokenBAddress);

      const pool = await miniDEX.getPool(0);
      expect(await miniDEX.poolCount()).to.equal(1);
      expect(pool.tokenA).to.equal(tokenAAddress);
      expect(pool.tokenB).to.equal(tokenBAddress);
      expect(pool.reserveA).to.equal(0);
      expect(pool.reserveB).to.equal(0);
      expect(pool.createdTimestamp).to.be.greaterThan(0);
    });

    it("rejects zero addresses and identical tokens", async function () {
      const { miniDEX, tokenA } =
        await networkHelpers.loadFixture(deployWithTokensFixture);
      const tokenAAddress = await tokenA.getAddress();

      await expect(
        miniDEX.createPool(ethers.ZeroAddress, tokenAAddress),
      ).to.be.revertedWith("Zero token address");
      await expect(
        miniDEX.createPool(tokenAAddress, ethers.ZeroAddress),
      ).to.be.revertedWith("Zero token address");
      await expect(
        miniDEX.createPool(tokenAAddress, tokenAAddress),
      ).to.be.revertedWith("Identical tokens");
    });

    it("rejects duplicate pairs in either token order", async function () {
      const { miniDEX, tokenA, tokenB } =
        await networkHelpers.loadFixture(deployWithTokensFixture);
      const tokenAAddress = await tokenA.getAddress();
      const tokenBAddress = await tokenB.getAddress();
      await miniDEX.createPool(tokenAAddress, tokenBAddress);

      await expect(
        miniDEX.createPool(tokenAAddress, tokenBAddress),
      ).to.be.revertedWith("Pool already exists");
      await expect(
        miniDEX.createPool(tokenBAddress, tokenAAddress),
      ).to.be.revertedWith("Pool already exists");
    });

    it("rejects queries for pools that do not exist", async function () {
      const { miniDEX } = await networkHelpers.loadFixture(deployFixture);
      await expect(miniDEX.getPool(0)).to.be.revertedWith("Pool does not exist");
    });
  });

  describe("Initial liquidity", function () {
    it("transfers both tokens and mints an LP NFT for the provider", async function () {
      const { miniDEX, tokenA, tokenB, owner } =
        await networkHelpers.loadFixture(createPoolFixture);
      const ownerAddress = await owner.getAddress();
      const dexAddress = await miniDEX.getAddress();
      const amountA = ethers.parseEther("1000");
      const amountB = ethers.parseEther("2000");
      const expectedShares = 1414213562373095048801n;

      await tokenA.approve(dexAddress, amountA);
      await tokenB.approve(dexAddress, amountB);
      await expect(miniDEX.addLiquidity(0, amountA, amountB, amountA, amountB))
        .to.emit(miniDEX, "Transfer")
        .withArgs(ethers.ZeroAddress, ownerAddress, 1);

      const pool = await miniDEX.getPool(0);
      const position = await miniDEX.positions(1);
      expect(pool.reserveA).to.equal(amountA);
      expect(pool.reserveB).to.equal(amountB);
      expect(pool.totalShares).to.equal(expectedShares);
      expect(position.poolId).to.equal(0);
      expect(position.shares).to.equal(expectedShares);
      expect(position.amountA).to.equal(amountA);
      expect(position.amountB).to.equal(amountB);
      expect(position.createdTimestamp).to.be.greaterThan(0);
      expect(await miniDEX.ownerOf(1)).to.equal(ownerAddress);
      expect(await miniDEX.balanceOf(ownerAddress)).to.equal(1);
      expect(await tokenA.balanceOf(dexAddress)).to.equal(amountA);
      expect(await tokenB.balanceOf(dexAddress)).to.equal(amountB);
    });

    it("rejects missing pools, zero amounts and amounts below the minimum", async function () {
      const { miniDEX } = await networkHelpers.loadFixture(createPoolFixture);
      const amountA = ethers.parseEther("1000");
      const amountB = ethers.parseEther("2000");

      await expect(
        miniDEX.addLiquidity(1, amountA, amountB, amountA, amountB),
      ).to.be.revertedWith("Pool does not exist");
      await expect(miniDEX.addLiquidity(0, 0, amountB, 0, 0)).to.be.revertedWith(
        "Amount must be greater than zero",
      );
      await expect(
        miniDEX.addLiquidity(0, amountA, amountB, amountA + 1n, amountB),
      ).to.be.revertedWith("Token A below minimum");
      await expect(
        miniDEX.addLiquidity(0, amountA, amountB, amountA, amountB + 1n),
      ).to.be.revertedWith("Token B below minimum");
    });
  });

  describe("Swaps", function () {
    it("swaps A for B with a 0.3% fee and updates both balances", async function () {
      const { miniDEX, tokenA, tokenB, otherAccount, initialA, initialB } =
        await networkHelpers.loadFixture(initializedPoolFixture);
      const traderAddress = await otherAccount.getAddress();
      const tokenAAddress = await tokenA.getAddress();
      const dexAddress = await miniDEX.getAddress();
      const amountIn = ethers.parseEther("100");
      const effectiveInput = amountIn * 997n / 1000n;
      const expectedOutput = effectiveInput * initialB / (initialA + effectiveInput);

      await tokenA.connect(otherAccount).faucet();
      await tokenA.connect(otherAccount).approve(dexAddress, amountIn);
      await expect(
        miniDEX.connect(otherAccount).swapExactInput(
          0,
          tokenAAddress,
          amountIn,
          expectedOutput,
        ),
      )
        .to.emit(miniDEX, "Swap")
        .withArgs(0, traderAddress, tokenAAddress, amountIn, expectedOutput);

      const pool = await miniDEX.getPool(0);
      expect(pool.reserveA).to.equal(initialA + amountIn);
      expect(pool.reserveB).to.equal(initialB - expectedOutput);
      expect(pool.reserveA * pool.reserveB).to.be.greaterThan(initialA * initialB);
      expect(await tokenA.balanceOf(traderAddress)).to.equal(
        ethers.parseEther("900"),
      );
      expect(await tokenB.balanceOf(traderAddress)).to.equal(expectedOutput);
    });

    it("swaps B for A using the same formula in reverse", async function () {
      const { miniDEX, tokenA, tokenB, otherAccount, initialA, initialB } =
        await networkHelpers.loadFixture(initializedPoolFixture);
      const traderAddress = await otherAccount.getAddress();
      const tokenBAddress = await tokenB.getAddress();
      const dexAddress = await miniDEX.getAddress();
      const amountIn = ethers.parseEther("50");
      const effectiveInput = amountIn * 997n / 1000n;
      const expectedOutput = effectiveInput * initialA / (initialB + effectiveInput);

      await tokenB.connect(otherAccount).faucet();
      await tokenB.connect(otherAccount).approve(dexAddress, amountIn);
      await miniDEX.connect(otherAccount).swapExactInput(
        0,
        tokenBAddress,
        amountIn,
        expectedOutput,
      );

      const pool = await miniDEX.getPool(0);
      expect(pool.reserveA).to.equal(initialA - expectedOutput);
      expect(pool.reserveB).to.equal(initialB + amountIn);
      expect(await tokenA.balanceOf(traderAddress)).to.equal(expectedOutput);
      expect(await tokenB.balanceOf(traderAddress)).to.equal(
        ethers.parseEther("950"),
      );
    });

    it("rejects invalid swaps and outputs below the caller's minimum", async function () {
      const { miniDEX, tokenA } =
        await networkHelpers.loadFixture(initializedPoolFixture);
      const tokenAAddress = await tokenA.getAddress();
      const amountIn = ethers.parseEther("100");

      await expect(
        miniDEX.swapExactInput(1, tokenAAddress, amountIn, 0),
      ).to.be.revertedWith("Pool does not exist");
      await expect(
        miniDEX.swapExactInput(0, tokenAAddress, 0, 0),
      ).to.be.revertedWith("Amount must be greater than zero");
      await expect(
        miniDEX.swapExactInput(0, ethers.ZeroAddress, amountIn, 0),
      ).to.be.revertedWith("Token not in pool");
      await expect(
        miniDEX.swapExactInput(0, tokenAAddress, amountIn, ethers.MaxUint256),
      ).to.be.revertedWith("Insufficient output amount");
    });

    it("does not allow swaps in an empty pool", async function () {
      const { miniDEX, tokenA } = await networkHelpers.loadFixture(createPoolFixture);
      await expect(
        miniDEX.swapExactInput(0, await tokenA.getAddress(), 1, 0),
      ).to.be.revertedWith("Pool has no liquidity");
    });
  });

  describe("Additional liquidity and redemption", function () {
    it("mints proportional shares for a later provider", async function () {
      const { miniDEX, tokenA, tokenB, otherAccount } =
        await networkHelpers.loadFixture(initializedPoolFixture);
      const otherAddress = await otherAccount.getAddress();
      const dexAddress = await miniDEX.getAddress();
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("200");
      const poolBefore = await miniDEX.getPool(0);
      const expectedShares = amountA * poolBefore.totalShares / poolBefore.reserveA;

      await tokenA.connect(otherAccount).faucet();
      await tokenB.connect(otherAccount).faucet();
      await tokenA.connect(otherAccount).approve(dexAddress, amountA);
      await tokenB.connect(otherAccount).approve(dexAddress, amountB);
      await miniDEX.connect(otherAccount).addLiquidity(
        0,
        amountA,
        amountB,
        amountA,
        amountB,
      );

      const pool = await miniDEX.getPool(0);
      const position = await miniDEX.positions(2);
      expect(pool.reserveA).to.equal(poolBefore.reserveA + amountA);
      expect(pool.reserveB).to.equal(poolBefore.reserveB + amountB);
      expect(pool.totalShares).to.equal(poolBefore.totalShares + expectedShares);
      expect(position.shares).to.equal(expectedShares);
      expect(await miniDEX.ownerOf(2)).to.equal(otherAddress);
    });

    it("uses the current pool ratio and enforces minimum accepted amounts", async function () {
      const { miniDEX, tokenA, tokenB, otherAccount } =
        await networkHelpers.loadFixture(initializedPoolFixture);
      const otherAddress = await otherAccount.getAddress();
      const dexAddress = await miniDEX.getAddress();
      const desiredA = ethers.parseEther("100");
      const desiredB = ethers.parseEther("150");
      const actualA = ethers.parseEther("75");

      await tokenA.connect(otherAccount).faucet();
      await tokenB.connect(otherAccount).faucet();
      await tokenA.connect(otherAccount).approve(dexAddress, desiredA);
      await tokenB.connect(otherAccount).approve(dexAddress, desiredB);
      await expect(
        miniDEX.connect(otherAccount).addLiquidity(
          0,
          desiredA,
          desiredB,
          actualA + 1n,
          desiredB,
        ),
      ).to.be.revertedWith("Token A below minimum");

      await miniDEX.connect(otherAccount).addLiquidity(
        0,
        desiredA,
        desiredB,
        actualA,
        desiredB,
      );
      const pool = await miniDEX.getPool(0);
      expect(pool.reserveA).to.equal(ethers.parseEther("1075"));
      expect(pool.reserveB).to.equal(ethers.parseEther("2150"));
      expect(await tokenA.balanceOf(otherAddress)).to.equal(
        ethers.parseEther("925"),
      );
      expect(await tokenB.balanceOf(otherAddress)).to.equal(
        ethers.parseEther("850"),
      );
    });

    it("returns reserves including accrued fees when the only LP exits", async function () {
      const { miniDEX, tokenA, tokenB, owner, otherAccount, initialA, initialB } =
        await networkHelpers.loadFixture(initializedPoolFixture);
      const ownerAddress = await owner.getAddress();
      const dexAddress = await miniDEX.getAddress();
      const amountIn = ethers.parseEther("100");
      const effectiveInput = amountIn * 997n / 1000n;
      const swapOutput = effectiveInput * initialB / (initialA + effectiveInput);

      await tokenA.connect(otherAccount).faucet();
      await tokenA.connect(otherAccount).approve(dexAddress, amountIn);
      await miniDEX.connect(otherAccount).swapExactInput(
        0,
        await tokenA.getAddress(),
        amountIn,
        swapOutput,
      );

      const ownerABefore = await tokenA.balanceOf(ownerAddress);
      const ownerBBefore = await tokenB.balanceOf(ownerAddress);
      const expectedA = initialA + amountIn;
      const expectedB = initialB - swapOutput;
      await expect(miniDEX.removeLiquidity(1, expectedA, expectedB))
        .to.emit(miniDEX, "Transfer")
        .withArgs(ownerAddress, ethers.ZeroAddress, 1);

      const pool = await miniDEX.getPool(0);
      expect(pool.reserveA).to.equal(0);
      expect(pool.reserveB).to.equal(0);
      expect(pool.totalShares).to.equal(0);
      expect(await tokenA.balanceOf(ownerAddress)).to.equal(ownerABefore + expectedA);
      expect(await tokenB.balanceOf(ownerAddress)).to.equal(ownerBBefore + expectedB);
      await expect(miniDEX.ownerOf(1)).to.revert(ethers);
    });

    it("burns a partial position and leaves the other provider's share intact", async function () {
      const { miniDEX, tokenA, tokenB, owner, otherAccount } =
        await networkHelpers.loadFixture(initializedPoolFixture);
      const otherAddress = await otherAccount.getAddress();
      const dexAddress = await miniDEX.getAddress();
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("200");

      await tokenA.connect(otherAccount).faucet();
      await tokenB.connect(otherAccount).faucet();
      await tokenA.connect(otherAccount).approve(dexAddress, amountA);
      await tokenB.connect(otherAccount).approve(dexAddress, amountB);
      await miniDEX.connect(otherAccount).addLiquidity(0, amountA, amountB, 0, 0);

      const poolBefore = await miniDEX.getPool(0);
      const position = await miniDEX.positions(2);
      const expectedA = position.shares * poolBefore.reserveA / poolBefore.totalShares;
      const expectedB = position.shares * poolBefore.reserveB / poolBefore.totalShares;
      const otherABefore = await tokenA.balanceOf(otherAddress);
      const otherBBefore = await tokenB.balanceOf(otherAddress);
      await miniDEX.connect(otherAccount).removeLiquidity(2, expectedA, expectedB);

      const pool = await miniDEX.getPool(0);
      expect(pool.reserveA).to.equal(poolBefore.reserveA - expectedA);
      expect(pool.reserveB).to.equal(poolBefore.reserveB - expectedB);
      expect(pool.totalShares).to.equal(poolBefore.totalShares - position.shares);
      expect(await tokenA.balanceOf(otherAddress)).to.equal(otherABefore + expectedA);
      expect(await tokenB.balanceOf(otherAddress)).to.equal(otherBBefore + expectedB);
      await expect(miniDEX.ownerOf(2)).to.revert(ethers);
      expect(await miniDEX.ownerOf(1)).to.equal(await owner.getAddress());
    });

    it("rejects redemption by someone else or below the minimum amounts", async function () {
      const { miniDEX, owner, otherAccount } =
        await networkHelpers.loadFixture(initializedPoolFixture);
      await expect(
        miniDEX.connect(otherAccount).removeLiquidity(1, 0, 0),
      ).to.be.revertedWith("Not position owner");
      await expect(
        miniDEX.removeLiquidity(1, ethers.MaxUint256, 0),
      ).to.be.revertedWith("Token A below minimum");
      expect(await miniDEX.ownerOf(1)).to.equal(await owner.getAddress());
    });
  });
});
