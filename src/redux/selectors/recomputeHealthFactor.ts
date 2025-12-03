import Decimal from "decimal.js";
import { clone } from "ramda";
import { createSelector } from "@reduxjs/toolkit";
import { expandTokenDecimal } from "@/utils/numbers";
import { MAX_RATIO } from "@/services/constantConfig";
import { RootState } from "../store";
import { hasAssets } from "@/utils/lendingUtil";
import { getAdjustedSum } from "./getWithdrawMaxAmount";
import { Portfolio } from "@rhea-finance/cross-chain-sdk";

export const recomputeHealthFactor = (
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
      if (!account.portfolio || !tokenId)
        return { healthFactor: 0, maxBorrowValue: 0 };
      const asset = assets.data[tokenId];
      const { metadata, config } = asset;
      const decimals = metadata.decimals + config.extra_decimals;
      const clonedPortfolio: Portfolio = clone(
        portfolioMinusGas || account.portfolio
      );
      if (!clonedPortfolio.positions[position]) {
        clonedPortfolio.positions[position] = {
          borrowed: {
            [tokenId]: {
              balance: "0",
              shares: "0",
              apr: "0",
            },
          },
          collateral: {},
        };
      } else if (!clonedPortfolio.positions[position].borrowed[tokenId]) {
        clonedPortfolio.positions[position].borrowed[tokenId] = {
          balance: "0",
          shares: "0",
          apr: "0",
        };
      }
      const newBalance = expandTokenDecimal(amount, decimals)
        .plus(
          new Decimal(
            clonedPortfolio.positions[position].borrowed[tokenId]?.balance || 0
          )
        )
        .toFixed();
      clonedPortfolio.positions[position].borrowed[tokenId].balance =
        newBalance;
      const portfolio = amount === 0 ? account.portfolio : clonedPortfolio;

      const adjustedCollateralSum = getAdjustedSum(
        "collateral",
        account.portfolio,
        assets.data,
        position
      );
      const adjustedBorrowedSum = getAdjustedSum(
        "borrowed",
        portfolio,
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
