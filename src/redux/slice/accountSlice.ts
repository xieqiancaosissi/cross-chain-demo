import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { initialState } from "../state/accountState";
import {
  getAccountBalance,
  IAccountAllPositionsDetailed,
  IAssetDetailed,
  getBalance,
  config_near,
  transformPortfolio,
} from "rhea-cross-chain-sdk";

const transformAccount = (account) => {
  if (!account) return undefined;

  const { accountId } = account;

  return {
    accountId,
    portfolio: transformPortfolio(account),
  };
};

export const fetchAccount = createAsyncThunk(
  "account/fetchAccount",
  async ({
    account_all_positions,
    assets_paged_detailed,
    account_id,
  }: {
    account_all_positions?: IAccountAllPositionsDetailed;
    assets_paged_detailed?: IAssetDetailed[];
    account_id: string;
  }) => {
    if (account_id) {
      const hiddenAssets = config_near.hiddenAssets || [];
      const _availableAssets = assets_paged_detailed.filter(
        (asset) => !hiddenAssets.includes(asset.token_id)
      );
      const tokenIds = _availableAssets.reduce((acc: string[], asset) => {
        const token_id: string = asset.token_id;
        acc.push(token_id);
        return acc;
      }, []);
      const account = transformAccount({
        accountId: account_id,
        portfolio: account_all_positions,
        tokenIds,
      });
      return account;
    }
    return undefined;
  }
);

export const fetchTokenBalances = createAsyncThunk(
  "account/fetchTokenBalances",
  async ({
    accountId,
    tokenIds,
    accountbalance,
  }: {
    accountId: string;
    tokenIds?: string[];
    accountbalance?: boolean;
  }) => {
    let result = {};
    if (accountbalance) {
      // get account near balance
      const { accountBalance, totalAccountBalance } = await getAccountBalance(
        accountId
      );
      result = {
        near: accountBalance,
        totalNear: totalAccountBalance,
      };
    }
    if (tokenIds?.length > 0) {
      // get token balances
      const balances = (
        await Promise.all(tokenIds.map((id) => getBalance(id, accountId)))
      ).reduce((acc, cur, index) => {
        acc[tokenIds[index]] = cur;
        return acc;
      }, {});
      result = { ...result, ...balances };
    }
    return result;
  }
);

export const accountSlice = createSlice({
  name: "account",
  initialState,
  reducers: {
    logoutAccount: () => initialState,
    setAccountId: (state, action) => {
      state.accountId = action.payload;
    },
    setIsClaiming: (state, action) => {
      state.isClaiming = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchAccount.pending, (state, action) => {
      state.status = action.meta.requestStatus;
    });
    builder.addCase(fetchAccount.rejected, (state, action) => {
      state.status = action.meta.requestStatus;
      console.error(action.payload);
      throw new Error("Failed to fetch account");
    });
    builder.addCase(fetchAccount.fulfilled, (state, action) => {
      state.status = action.meta.requestStatus;
      state.fetchedAt = new Date().toString();
      if (!action.payload?.accountId) return;
      const { accountId, portfolio } = action.payload;
      state.accountId = accountId;
      if (portfolio) {
        state.portfolio = portfolio;
      } else {
        state.portfolio = initialState.portfolio;
      }
    });
    builder.addCase(fetchTokenBalances.fulfilled, (state, action) => {
      state.balances = {
        ...(state.balances || {}),
        ...action.payload,
      };
    });
  },
});

export const { logoutAccount, setAccountId, setIsClaiming } =
  accountSlice.actions;
export default accountSlice.reducer;
