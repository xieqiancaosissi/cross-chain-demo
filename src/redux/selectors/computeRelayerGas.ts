import Decimal from "decimal.js";
import _ from "lodash";
import { clone } from "ramda";
import { createSelector } from "@reduxjs/toolkit";
import { shrinkToken } from "@/utils/numbers";
import { MAX_RATIO } from "@/services/constantConfig";
import { RootState } from "@/redux/store";
import { getAdjustedSum } from "@/redux/selectors/getWithdrawMaxAmount";
import { Portfolio } from "@rhea-finance/cross-chain-sdk";
import { AssetsState } from "@/redux/state/assetState";
import { DEFAULT_POSITION } from "@/services/constantConfig";
import { expandTokenDecimal } from "@/utils/numbers";
import { decimalMax, decimalMin, hasAssets } from "@/utils/lendingUtil";
import { config_near } from "@rhea-finance/cross-chain-sdk";
const { WRAP_NEAR_CONTRACT_ID } = config_near;

export const computeRelayerGas = ({
  nearStorageAmount,
  mca,
  relayerGasFees,
}: {
  nearStorageAmount: string | number;
  mca: string;
  relayerGasFees: Record<string, string>;
}) =>
  createSelector(
    (state: RootState) => state.assets,
    (state: RootState) => state.account,
    (assets, account) => {
      if (!mca) return;
      if (!hasAssets(assets) || !account.portfolio) return;
      const { tokenId, amount, relayerFeeUsd } = searchMatchAssetId({
        portfolio: account.portfolio,
        assets,
        nearStorageAmount,
        relayerGasFees,
      });
      if (!tokenId) return;
      const asset = assets.data[tokenId];
      const { metadata, config } = asset;
      const position = DEFAULT_POSITION;
      const decimals = metadata.decimals + config.extra_decimals;
      const clonedPortfolio: Portfolio = clone(account.portfolio);

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
      const newSuppliedBalance = decimalMax(
        0,
        suppliedBalance.minus(amountDecimal)
      );
      // update supplied on portfolio
      const newSuppliedBalanceMap = {
        shares: newSuppliedBalance.toFixed(),
        balance: newSuppliedBalance.toFixed(),
      };
      clonedPortfolio.supplied[tokenId] = {
        ...(clonedPortfolio.supplied[tokenId] || {}),
        ...newSuppliedBalanceMap,
      };
      const targetSuppply = clonedPortfolio.supplies?.find(
        (t) => t.token_id == tokenId
      );
      if (targetSuppply) {
        targetSuppply.shares = newSuppliedBalanceMap.shares;
        targetSuppply.balance = newSuppliedBalanceMap.balance;
      }
      // update collateral on portfolio
      const newCollateralBalanceMap = {
        shares: newCollateralBalance.toFixed(),
        balance: newCollateralBalance.toFixed(),
      };
      clonedPortfolio.collateralAll[tokenId] = {
        ...(clonedPortfolio.collateralAll[tokenId] || {}),
        ...newCollateralBalanceMap,
      };
      clonedPortfolio.collateral[tokenId] = {
        ...(clonedPortfolio.collateral[tokenId] || {}),
        ...newCollateralBalanceMap,
      };
      const targetCollateral = clonedPortfolio.collaterals?.find(
        (t) => t.token_id == tokenId
      );
      if (targetCollateral) {
        targetCollateral.shares = newCollateralBalanceMap.shares;
        targetCollateral.balance = newCollateralBalanceMap.balance;
      }

      clonedPortfolio.positions[position].collateral[tokenId] = {
        ...clonedPortfolio.positions[position].collateral[tokenId],
        ...newCollateralBalanceMap,
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
      const healthFactorTemp = adjustedCollateralSum
        .div(adjustedBorrowedSum)
        .mul(100)
        .toNumber();
      const healthFactor =
        healthFactorTemp < MAX_RATIO ? healthFactorTemp : MAX_RATIO;
      if (healthFactor > 105) {
        return {
          portfolioMinusGas: clonedPortfolio,
          tokenId,
          amount,
          relayerFeeUsd,
          amountToken: expandTokenDecimal(
            amount,
            asset.metadata.decimals
          ).toFixed(0, Decimal.ROUND_DOWN),
          amountBurrow: expandTokenDecimal(
            amount,
            asset.config.extra_decimals + asset.metadata.decimals
          ).toFixed(0, Decimal.ROUND_DOWN),
        };
      }
      return;
    }
  );

function searchMatchAssetId({
  portfolio,
  assets,
  nearStorageAmount,
  relayerGasFees,
}: {
  portfolio: Portfolio;
  assets: AssetsState;
  nearStorageAmount: string | number;
  relayerGasFees: Record<string, string>;
}) {
  const costNearUSD = new Decimal(
    assets.data[WRAP_NEAR_CONTRACT_ID]?.price?.usd || 0
  ).mul(nearStorageAmount || 0);
  const _suppliesUsd = portfolio.supplies?.map((item) => {
    const { token_id, balance } = item;
    const _asset = assets.data[token_id];
    console.log("--------------------------------_asset", _asset, token_id);
    const _price = _asset.price?.usd || 0;
    const _amount = shrinkToken(
      balance,
      _asset.config.extra_decimals + _asset.metadata.decimals
    );
    const _amount_relayer =
      shrinkToken(relayerGasFees[token_id] || 0, _asset.metadata.decimals) || 0;
    return {
      token_id,
      token_price: _price,
      token_decimals: _asset?.metadata?.decimals || 0,
      token_usd: new Decimal(_amount_relayer).gt(0)
        ? new Decimal(_price).mul(_amount).toFixed()
        : "0",
      relayerFeeUsd: new Decimal(_price).mul(_amount_relayer).toFixed(),
      totalFeeUsd: new Decimal(_price)
        .mul(_amount_relayer)
        .plus(costNearUSD)
        .toFixed(),
    };
  });
  const maxSuppplied = _.maxBy(_suppliesUsd, (o) => +o.token_usd);
  if (
    new Decimal(maxSuppplied?.token_usd || 0).gt(0) &&
    new Decimal(maxSuppplied?.token_usd || 0).gte(
      maxSuppplied?.totalFeeUsd || 0
    )
  ) {
    return {
      tokenId: maxSuppplied?.token_id,
      amount: new Decimal(maxSuppplied?.token_price || 0).gt(0)
        ? new Decimal(maxSuppplied?.totalFeeUsd || 0)
            .div(maxSuppplied?.token_price)
            .toFixed(maxSuppplied?.token_decimals || 0)
        : "0",
      relayerFeeUsd: maxSuppplied?.relayerFeeUsd,
    };
  } else {
    const _collateralUsd = Object.entries(
      portfolio?.positions?.[DEFAULT_POSITION]?.collateral || {}
    ).map(([token_id, _item]) => {
      const _asset = assets.data[token_id];
      const _price = _asset.price?.usd || 0;
      const _amount = shrinkToken(
        _item.balance,
        _asset.config.extra_decimals + _asset.metadata.decimals
      );
      const _amount_relayer =
        shrinkToken(relayerGasFees[token_id] || 0, _asset.metadata.decimals) ||
        0;
      return {
        token_id,
        token_price: _price,
        token_decimals: _asset?.metadata?.decimals || 0,
        token_usd: new Decimal(_amount_relayer).gt(0)
          ? new Decimal(_price).mul(_amount)
          : "0",
        relayerFeeUsd: new Decimal(_price).mul(_amount_relayer).toFixed(),
        totalFeeUsd: new Decimal(_price).mul(_amount_relayer).plus(costNearUSD),
      };
    });
    const maxCollateral = _.maxBy(_collateralUsd, (o) => +o.token_usd);
    if (
      new Decimal(maxCollateral?.token_usd || 0).gte(
        maxCollateral?.totalFeeUsd || 0
      )
    ) {
      return {
        tokenId: maxCollateral?.token_id,
        amount: new Decimal(maxCollateral?.token_price || 0).gt(0)
          ? new Decimal(maxCollateral?.totalFeeUsd || 0)
              .div(maxCollateral?.token_price)
              .toFixed(maxCollateral?.token_decimals || 0)
          : "0",
        relayerFeeUsd: maxCollateral?.relayerFeeUsd,
      };
    }
  }
  return {};
}
