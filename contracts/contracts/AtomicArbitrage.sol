// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IMiniDEX {
    function swapExactInput(
        uint256 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut
    ) external returns (uint256 amountOut);
}

contract AtomicArbitrage is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct ArbitrageParams {
        address buyDex;
        address sellDex;
        uint256 buyPoolId;
        uint256 sellPoolId;
        address tokenA;
        address tokenB;
        uint256 amountIn;
        uint256 minProfit;
    }

    event ArbitrageExecuted(
        address indexed trader,
        uint256 amountIn,
        uint256 amountOut,
        uint256 profit
    );

    function arbitrage(
        ArbitrageParams calldata params
    ) external nonReentrant returns (uint256 profit) {
        require(params.amountIn > 0, "Amount must be greater than zero");
        require(params.minProfit > 0, "Minimum profit must be greater than zero");

        IERC20 tokenA = IERC20(params.tokenA);
        IERC20 tokenB = IERC20(params.tokenB);
        uint256 balanceBefore = tokenA.balanceOf(address(this));
        tokenA.safeTransferFrom(msg.sender, address(this), params.amountIn);

        tokenA.forceApprove(params.buyDex, params.amountIn);
        uint256 amountB = IMiniDEX(params.buyDex).swapExactInput(
            params.buyPoolId,
            params.tokenA,
            params.amountIn,
            0
        );

        tokenB.forceApprove(params.sellDex, amountB);
        IMiniDEX(params.sellDex).swapExactInput(
            params.sellPoolId,
            params.tokenB,
            amountB,
            0
        );

        uint256 amountOut = tokenA.balanceOf(address(this)) - balanceBefore;
        require(amountOut > params.amountIn, "Arbitrage not profitable");
        profit = amountOut - params.amountIn;
        require(profit >= params.minProfit, "Arbitrage not profitable");
        tokenA.safeTransfer(msg.sender, amountOut);
        emit ArbitrageExecuted(msg.sender, params.amountIn, amountOut, profit);
    }
}
