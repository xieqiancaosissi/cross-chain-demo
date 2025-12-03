import Decimal from "decimal.js";
import { clone } from "ramda";
import { createSelector } from "@reduxjs/toolkit";
import { expandTokenDecimal } from "@/utils/numbers";
import { MAX_RATIO, DEFAULT_POSITION } from "@/services/constantConfig";
import { RootState } from "../store";
import { hasAssets } from "@/utils/lendingUtil";
import { getAdjustedSum } from "./getWithdrawMaxAmount";
import { decimalMax, decimalMin } from "@/utils/lendingUtil";
import { Portfolio } from "@rhea-finance/cross-chain-sdk";

export const recomputeHealthFactorWithdraw = (
  tokenId: string,
  amount: number,
  portfolioMinusGas: Portfolio
) =>
  createSelector(
    (state: RootState) => state.assets,
    (state: RootState) => state.account,
    (assets, account) => {
      if (!hasAssets(assets)) return { healthFactor: 0, maxBorrowValue: 0 };
      if (!account.portfolio || !tokenId)
        return { healthFactor: 0, maxBorrowValue: 0 };
      const asset = assets.data[tokenId];
      const { metadata, config, isLpToken } = asset;
      const position = isLpToken ? tokenId : DEFAULT_POSITION;
      const decimals = metadata.decimals + config.extra_decimals;
      const clonedPortfolio: Portfolio = clone(
        portfolioMinusGas || account.portfolio
      );
      if (!clonedPortfolio.positions[position]) {
        clonedPortfolio.positions[position] = {
          collateral: {
            [tokenId]: {
              balance: "0",
              shares: "0",
              apr: "0",
            },
          },
          borrowed: {},
        };
      } else if (!clonedPortfolio.positions[position].collateral[tokenId]) {
        clonedPortfolio.positions[position].collateral[tokenId] = {
          balance: "0",
          shares: "0",
          apr: "0",
        };
      }

      if (!clonedPortfolio.supplied[tokenId]) {
        clonedPortfolio.supplied[tokenId] = {
          balance: "0",
          shares: "0",
          apr: "0",
        };
      }
      const collateralBalance = new Decimal(
        clonedPortfolio.positions[position].collateral[tokenId].balance
      );
      const suppliedBalance = new Decimal(
        clonedPortfolio.supplied[tokenId].balance
      );
      const amountDecimal = expandTokenDecimal(amount, decimals);

      const newCollateralBalance = decimalMax(
        0,
        decimalMin(
          collateralBalance,
          collateralBalance.plus(suppliedBalance).minus(amountDecimal)
        )
      );

      clonedPortfolio.positions[position].collateral[tokenId] = {
        ...clonedPortfolio.positions[position].collateral[tokenId],
        shares: newCollateralBalance.toFixed(),
        balance: newCollateralBalance.toFixed(),
      };
      const adjustedCollateralSum = getAdjustedSum(
        "collateral",
        clonedPortfolio,
        assets.data,
        position
      );
      const adjustedBorrowedSum = getAdjustedSum(
        "borrowed",
        account.portfolio,
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
