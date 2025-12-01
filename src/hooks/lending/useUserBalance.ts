import Decimal from "decimal.js";
import { useAppSelector } from "./useRedux";
import { getAssetDataByTokenId } from "@/redux/selectors/appSelectors";
import { getBorrowMaxAmount } from "@/redux/selectors/getBorrowMaxAmount";
import { NEAR_STORAGE_RESERVED } from "@/services/constantConfig";

export function useUserBalance(tokenId: string, isWrappedNear: boolean) {
  const asset = useAppSelector(getAssetDataByTokenId(tokenId));
  const maxBorrowAmountPositions = useAppSelector(getBorrowMaxAmount(tokenId));
  const { available, availableNEAR } = asset;
  // get supply balance
  let supplyBalance = "0";
  if (isWrappedNear) {
    supplyBalance = Decimal.max(
      new Decimal(available || 0)
        .plus(availableNEAR || 0)
        .minus(NEAR_STORAGE_RESERVED),
      0
    ).toFixed();
  } else {
    supplyBalance = new Decimal(available || 0).toFixed();
  }
  return {
    supplyBalance,
    maxBorrowAmountPositions,
  };
}
