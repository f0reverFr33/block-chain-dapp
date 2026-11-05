// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MiniDEX is ERC721, ReentrancyGuard {
    using SafeERC20 for IERC20;

    event PoolCreated(uint256 poolId, address tokenA, address tokenB);
    event Swap(
        uint256 poolId,
        address trader,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOut
    );

    struct Pool {
        address tokenA;
        address tokenB;
        uint256 reserveA;
        uint256 reserveB;
        uint256 totalShares;
        uint256 createdTimestamp;
    }

    struct Position {
        uint256 poolId;
        uint256 shares;
        uint256 amountA;
        uint256 amountB;
        uint256 createdTimestamp;
    }

    mapping(uint256 => Pool) public pools;
    mapping(bytes32 => uint256) private pairPoolIds;
    mapping(uint256 => Position) public positions;
    uint256 public poolCount;
    uint256 private nextPositionId = 1;

    constructor() ERC721("MiniDEX Liquidity Position", "MDEX-LP") {}

    function createPool(address tokenA, address tokenB) external returns (uint256 poolId) {
        require(tokenA != address(0) && tokenB != address(0), "Zero token address");
        require(tokenA != tokenB, "Identical tokens");

        bytes32 pairKey = getPairKey(tokenA, tokenB);
        require(pairPoolIds[pairKey] == 0, "Pool already exists");

        poolId = poolCount;
        poolCount++;
        pairPoolIds[pairKey] = poolId + 1;
        pools[poolId] = Pool({
            tokenA: tokenA,
            tokenB: tokenB,
            reserveA: 0,
            reserveB: 0,
            totalShares: 0,
            createdTimestamp: block.timestamp
        });

        emit PoolCreated(poolId, tokenA, tokenB);
    }

    function addLiquidity(
        uint256 poolId,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) external nonReentrant returns (uint256 tokenId, uint256 shares) {
        require(poolId < poolCount, "Pool does not exist");
        require(amountADesired > 0 && amountBDesired > 0, "Amount must be greater than zero");

        Pool storage pool = pools[poolId];
        uint256 amountA;
        uint256 amountB;
        if (pool.totalShares == 0) {
            amountA = amountADesired;
            amountB = amountBDesired;
            shares = Math.sqrt(amountA * amountB);
        } else {
            uint256 amountBOptimal = amountADesired * pool.reserveB / pool.reserveA;
            if (amountBOptimal <= amountBDesired) {
                amountA = amountADesired;
                amountB = amountBOptimal;
            } else {
                amountA = amountBDesired * pool.reserveA / pool.reserveB;
                amountB = amountBDesired;
            }
            shares = Math.min(
                amountA * pool.totalShares / pool.reserveA,
                amountB * pool.totalShares / pool.reserveB
            );
        }

        require(amountA >= amountAMin, "Token A below minimum");
        require(amountB >= amountBMin, "Token B below minimum");
        require(shares > 0, "Insufficient liquidity shares");

        pool.reserveA += amountA;
        pool.reserveB += amountB;
        pool.totalShares += shares;
        tokenId = nextPositionId++;
        positions[tokenId] = Position({
            poolId: poolId,
            shares: shares,
            amountA: amountA,
            amountB: amountB,
            createdTimestamp: block.timestamp
        });
        _mint(msg.sender, tokenId);

        IERC20(pool.tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(pool.tokenB).safeTransferFrom(msg.sender, address(this), amountB);
    }

    function removeLiquidity(
        uint256 tokenId,
        uint256 minAmountA,
        uint256 minAmountB
    ) external nonReentrant returns (uint256 amountA, uint256 amountB) {
        require(ownerOf(tokenId) == msg.sender, "Not position owner");
        Position storage position = positions[tokenId];
        Pool storage pool = pools[position.poolId];

        amountA = position.shares * pool.reserveA / pool.totalShares;
        amountB = position.shares * pool.reserveB / pool.totalShares;
        require(amountA > 0 && amountB > 0, "Insufficient redemption amount");
        require(amountA >= minAmountA, "Token A below minimum");
        require(amountB >= minAmountB, "Token B below minimum");

        pool.reserveA -= amountA;
        pool.reserveB -= amountB;
        pool.totalShares -= position.shares;
        delete positions[tokenId];
        _burn(tokenId);

        IERC20(pool.tokenA).safeTransfer(msg.sender, amountA);
        IERC20(pool.tokenB).safeTransfer(msg.sender, amountB);
    }

    function swapExactInput(
        uint256 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut
    ) external nonReentrant returns (uint256 amountOut) {
        require(poolId < poolCount, "Pool does not exist");
        require(amountIn > 0, "Amount must be greater than zero");

        Pool storage pool = pools[poolId];
        bool isTokenA = tokenIn == pool.tokenA;
        require(isTokenA || tokenIn == pool.tokenB, "Token not in pool");

        (uint256 reserveIn, uint256 reserveOut) = isTokenA
            ? (pool.reserveA, pool.reserveB)
            : (pool.reserveB, pool.reserveA);
        require(reserveIn > 0 && reserveOut > 0, "Pool has no liquidity");

        uint256 effectiveInput = amountIn * 997 / 1000;
        amountOut = effectiveInput * reserveOut / (reserveIn + effectiveInput);
        require(amountOut > 0 && amountOut >= minAmountOut, "Insufficient output amount");
        address tokenOut = isTokenA ? pool.tokenB : pool.tokenA;

        if (isTokenA) {
            pool.reserveA = reserveIn + amountIn;
            pool.reserveB = reserveOut - amountOut;
        } else {
            pool.reserveA = reserveOut - amountOut;
            pool.reserveB = reserveIn + amountIn;
        }

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
        emit Swap(poolId, msg.sender, tokenIn, amountIn, amountOut);
    }

    function getPool(uint256 poolId) external view returns (Pool memory) {
        require(poolId < poolCount, "Pool does not exist");
        return pools[poolId];
    }

    function getPairKey(address tokenA, address tokenB) private pure returns (bytes32) {
        (address first, address second) = uint160(tokenA) < uint160(tokenB)
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
        return keccak256(abi.encodePacked(first, second));
    }
}
