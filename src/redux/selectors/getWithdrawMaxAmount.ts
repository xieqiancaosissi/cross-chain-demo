import Decimal from "decimal.js";
import { clone } from "ramda";
import { createSelector } from "@reduxjs/toolkit";
import { RootState } from "../store";
import { shrinkToken, expandTokenDecimal } from "@/utils/numbers";
import { MAX_RATIO, DEFAULT_POSITION } from "@/services/constantConfig";
import { decimalMax, decimalMin } from "@/utils/lendingUtil";
import { IAssetsView } from "rhea-cross-chain-sdk";
import { Portfolio } from "../state/accountState";

const sumReducerDecimal = (sum: Decimal, cur: Decimal) => sum.add(cur);

export const getAdjustedSum = (
  type: "borrowed" | "collateral",
  portfolio: Portfolio,
  assets: IAssetsView,
  position?: string
) => {
  const positionId = position || DEFAULT_POSITION;
  const result = Object.keys(portfolio.positions[positionId]?.[type] || {}).map(
    (id) => {
      const asset = assets[id];
      const positionData = portfolio.positions[positionId][type][id];
      let pricedBalance;
      if (asset?.isLpToken) {
        const lpTokensBalance = new Decimal(positionData.balance).round();
        const unitShare = new Decimal(10).pow(asset.metadata.decimals);
        pricedBalance = asset.metadata.tokens.reduce((sum, tokenValue) => {
          const tokenAsset = assets[tokenValue.token_id];
          const tokenPrice = tokenValue.price || tokenAsset.price;
          const tokenStddAmount = expandTokenDecimal(
            tokenValue.amount,
            tokenAsset.config.extra_decimals
          );
          const tokenBalance = new Decimal(tokenStddAmount)
            .mul(
              shrinkToken(
                lpTokensBalance.toFixed(),
                asset.config.extra_decimals
              )
            )
            .div(new Decimal(unitShare));
          const tokenAssetVolatilitRatio = tokenAsset.config.volatility_ratio;
          const priceViotility = tokenBalance
            .mul(tokenPrice?.multiplier || 0)
            .div(
              new Decimal(10).pow(
                Number(tokenPrice?.decimals || 0) +
                  Number(tokenAsset.config.extra_decimals)
              )
            )
            .mul(tokenAssetVolatilitRatio)
            .div(MAX_RATIO);
          return sum.add(priceViotility);
        }, new Decimal(0));
      } else {
        const price = asset?.price
          ? new Decimal(asset.price.multiplier).div(
              new Decimal(10).pow(asset.price.decimals)
            )
          : new Decimal(0);
        pricedBalance = new Decimal(
          portfolio.positions[positionId][type][id].balance
        )
          .div(expandTokenDecimal(1, asset?.config?.extra_decimals || 0))
          .mul(price);
      }

      return type === "borrowed"
        ? pricedBalance.div(asset?.config?.volatility_ratio || 1).mul(MAX_RATIO)
        : pricedBalance
            .mul(asset?.config?.volatility_ratio || 1)
            .div(MAX_RATIO);
    }
  );

  const sumResult = result?.reduce(sumReducerDecimal, new Decimal(0));
  return sumResult || new Decimal(0);
};

export const computeWithdrawMaxAmount = (
  tokenId: string,
  assets: Assets,
  portfolio: Portfolio
) => {
  const asset = assets[tokenId];
  const position = asset.isLpToken ? tokenId : DEFAULT_POSITION;
  const assetPrice = asset.price
    ? new Decimal(asset.price.usd || "0")
    : new Decimal(0);
  const suppliedBalance = new Decimal(
    portfolio.supplied[tokenId]?.balance || 0
  );
  const collateralBalance = new Decimal(
    portfolio.positions[position]?.collateral?.[tokenId]?.balance || 0
  );

  let maxAmount = suppliedBalance;
  // has debt
  if (portfolio.borrows.length > 0 && collateralBalance.gt(0)) {
    const clonedPortfolio = clone(portfolio);
    clonedPortfolio.positions[position].collateral[tokenId] = {
      apr: "0",
      balance: "0",
      shares: "0",
    };
    const _adjustedCollateralSum = getAdjustedSum(
      "collateral",
      clonedPortfolio,
      assets,
      position
    );
    const adjustedBorrowedSum = getAdjustedSum(
      "borrowed",
      portfolio,
      assets,
      position
    );
    const healthFactor = _adjustedCollateralSum
      .div(adjustedBorrowedSum)
      .mul(100)
      .toNumber();
    if (healthFactor <= 105) {
      const adjustedCollateralSum = getAdjustedSum(
        "collateral",
        portfolio,
        assets,
        position
      );
      const adjustedPricedDiff = decimalMax(
        0,
        adjustedCollateralSum.sub(adjustedBorrowedSum)
      );
      const safeAdjustedPricedDiff = adjustedPricedDiff.mul(999).div(1000);

      const safePricedDiff = safeAdjustedPricedDiff
        .div(asset.config.volatility_ratio)
        .mul(10000);
      const safeDiff = safePricedDiff
        .div(assetPrice)
        .mul(
          expandTokenDecimal(
            1,
            asset.config.extra_decimals + asset.metadata.decimals
          )
        )
        .trunc();
      maxAmount = maxAmount.add(decimalMin(safeDiff, collateralBalance));
    } else {
      maxAmount = suppliedBalance.plus(collateralBalance);
    }
  } else {
    maxAmount = suppliedBalance.plus(collateralBalance);
  }

  return {
    maxAmount,
    canWithdrawAll: maxAmount.eq(suppliedBalance.plus(collateralBalance)),
  };
};

export const getWithdrawMaxAmount = (
  tokenId: string,
  portfolioMinusGas: Portfolio
) =>
  createSelector(
    (state: RootState) => state.app,
    (state: RootState) => state.assets.data,
    (state: RootState) => state.account.portfolio,
    (app, assets, portfolio) => {
      const asset = assets[tokenId];
      if (!asset || app.selected.tokenId !== tokenId) return 0;
      if (
        !["Withdraw", "Adjust", "Repay"].includes(app.selected.action as string)
      )
        return 0;

      const { metadata, config } = asset;
      const decimals = metadata.decimals + config.extra_decimals;

      const { maxAmount } = computeWithdrawMaxAmount(
        tokenId,
        assets,
        portfolioMinusGas || portfolio
      );

      return Number(shrinkToken(maxAmount.toFixed(), decimals));
    }
  );
