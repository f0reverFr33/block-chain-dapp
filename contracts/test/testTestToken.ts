import { expect } from "chai";
import hre from "hardhat";

const { ethers, networkHelpers } = await hre.network.create();

describe("TestToken", function () {
  async function deployTokenFixture() {
    const [deployer, alice, bob] = await ethers.getSigners();
    const token = await ethers.deployContract("TestToken", ["Test Token A", "TKA"]);
    await token.waitForDeployment();

    return { token, deployer, alice, bob };
  }

  it("gives the initial supply to the deployer", async function () {
    const { token, deployer } = await networkHelpers.loadFixture(deployTokenFixture);

    expect(await token.name()).to.equal("Test Token A");
    expect(await token.symbol()).to.equal("TKA");
    expect(await token.balanceOf(await deployer.getAddress())).to.equal(
      await token.INITIAL_SUPPLY(),
    );
  });

  it("lets different accounts claim test tokens once", async function () {
    const { token, alice, bob } = await networkHelpers.loadFixture(deployTokenFixture);
    const faucetAmount = await token.FAUCET_AMOUNT();

    await token.connect(alice).faucet();
    await token.connect(bob).faucet();

    expect(await token.balanceOf(await alice.getAddress())).to.equal(faucetAmount);
    expect(await token.balanceOf(await bob.getAddress())).to.equal(faucetAmount);
    await expect(token.connect(alice).faucet()).to.be.revertedWith("Already claimed");
  });

  it("supports transfers and allowance-based transfers", async function () {
    const { token, alice, bob } = await networkHelpers.loadFixture(deployTokenFixture);
    const aliceAddress = await alice.getAddress();
    const bobAddress = await bob.getAddress();

    await token.connect(alice).faucet();
    await token.connect(alice).transfer(bobAddress, ethers.parseEther("100"));
    await token.connect(alice).approve(bobAddress, ethers.parseEther("200"));
    await token.connect(bob).transferFrom(
      aliceAddress,
      bobAddress,
      ethers.parseEther("150"),
    );

    expect(await token.balanceOf(aliceAddress)).to.equal(ethers.parseEther("750"));
    expect(await token.balanceOf(bobAddress)).to.equal(ethers.parseEther("250"));
    expect(await token.allowance(aliceAddress, bobAddress)).to.equal(
      ethers.parseEther("50"),
    );
    await expect(
      token.connect(bob).transferFrom(
        aliceAddress,
        bobAddress,
        ethers.parseEther("51"),
      ),
    ).to.revert(ethers);
  });
});
