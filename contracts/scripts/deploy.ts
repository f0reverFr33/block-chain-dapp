import hre from "hardhat";

async function main() {
  const { ethers } = await hre.network.connect();
  const tokenA = await ethers.deployContract("TestToken", ["Test Token A", "TKA"]);
  const tokenB = await ethers.deployContract("TestToken", ["Test Token B", "TKB"]);
  const miniDEX = await ethers.deployContract("MiniDEX");
  await Promise.all([
    tokenA.waitForDeployment(),
    tokenB.waitForDeployment(),
    miniDEX.waitForDeployment(),
  ]);

  console.log(`TOKEN_A_ADDRESS=${await tokenA.getAddress()}`);
  console.log(`TOKEN_B_ADDRESS=${await tokenB.getAddress()}`);
  console.log(`MINIDEX_ADDRESS=${await miniDEX.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
