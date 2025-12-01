import Decimal from "decimal.js";
import { clone } from "ramda";
import { createSelector } from "@reduxjs/toolkit";
import { expandTokenDecimal } from "@/utils/numbers";
import { MAX_RATIO } from "@/services/constantConfig";
import { RootState } from "../store";
import { hasAssets } from "@/utils/lendingUtil";
import { getAdjustedSum } from "./getWithdrawMaxAmount";
import { decimalMax, decimalMin } from "@/utils/lendingUtil";
import { Portfolio } from "rhea-cross-chain-sdk";

export const recomputeHealthFactorRepayFromDeposits = (
  tokenId: string,
  amount: number,
  position: string,
  portfolioMinusGas: Portfolio
) =>
  createSelector(
    (state: RootState) => state.assets,
    (state: RootState) => state.account,
    (assets, account) => {
      if (!hasAssets(assets)) return { healthFactor: 0, maxBorrowValue: 0 };
      if (
        !account.portfolio ||
        !tokenId ||
        !account.portfolio.positions[position]?.borrowed?.[tokenId]
      )
        return { healthFactor: 0, maxBorrowValue: 0 };
      const asset = assets.data[tokenId];
      const { metadata, config } = asset;
      const decimals = metadata.decimals + config.extra_decimals;
      const amountDecimal = expandTokenDecimal(amount, decimals);
      const clonedPortfolio: Portfolio = clone(
        portfolioMinusGas || account.portfolio
      );
      // new borrowed balance
      const borrowedBalance = new Decimal(
        clonedPortfolio.positions[position].borrowed[tokenId].balance
      );
      const newBorrowedBalance = decimalMax(
        0,
        borrowedBalance.minus(amountDecimal)
      );
      // new collateral balance
      const collateralBalance = new Decimal(
        clonedPortfolio.positions[position]?.collateral?.[tokenId]?.balance || 0
      );
      const suppliedBalance = new Decimal(
        clonedPortfolio.supplied?.[tokenId]?.balance || 0
      );

      const newCollateralBalance = decimalMax(
        0,
        decimalMin(
          collateralBalance,
          collateralBalance.plus(suppliedBalance).minus(amountDecimal)
        )
      );
      // update collateral balance in position
      if (newCollateralBalance.lt(collateralBalance)) {
        clonedPortfolio.positions[position].collateral[tokenId] = {
          ...clonedPortfolio.positions[position].collateral[tokenId],
          shares: newCollateralBalance.toFixed(),
          balance: newCollateralBalance.toFixed(),
        };
      }

      // update borrowed balance in position
      clonedPortfolio.positions[position].borrowed[tokenId].balance =
        newBorrowedBalance.toFixed();
      const adjustedCollateralSum = getAdjustedSum(
        "collateral",
        clonedPortfolio,
        assets.data,
        position
      );
      const adjustedBorrowedSum = getAdjustedSum(
        "borrowed",
        clonedPortfolio,
        assets.data,
        position
      );
      const maxBorrowValue = adjustedCollateralSum.sub(adjustedBorrowedSum);
      const healthFactorTemp = adjustedCollateralSum
        .div(adjustedBorrowedSum)
        .mul(100)
        .toNumber();
      const healthFactor =
        healthFactorTemp < MAX_RATIO ? healthFactorTemp : MAX_RATIO;
      return { healthFactor, maxBorrowValue };
    }
  );
