require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-etherscan");
require("@nomicfoundation/hardhat-toolbox");
require("@nomicfoundation/hardhat-chai-matchers");
//require("@nomiclabs/hardhat-waffle");
require("hardhat-gas-reporter");
require("hardhat-tracer");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.9",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.6.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  paths: {
    sources: "./ethereum/contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      //Goerli fork
      forking: {
        url: process.env.ALCHEMY_ETHGOERLI_URL, //consider making this an env var
        blockNumber: 8000000,
      },
    },
    mumbai: {
      url: process.env.ALCHEMY_MUMBAI_URL, //process.env.ALCHEMY_MUMBAI_URL,
      accounts: [process.env.WALLET_PRIVATE_KEY], //[process.env.ACCOUNT_KEY],
    },
    goerli: {
      url: process.env.ALCHEMY_ETHGOERLI_URL,
      accounts: [process.env.WALLET_PRIVATE_KEY],
    },
    arbitrumOne: {
      url: process.env.ALCHEMY_ARBITRUM_URL,
      accounts: [process.env.WALLET_PRIVATE_KEY],
    },
    arbitrumGoerli: {
      url: "https://goerli-rollup.arbitrum.io/rpc",
      accounts: [process.env.WALLET_PRIVATE_KEY],
    },
    arbitrumTestnet: {
      url: "https://goerli-rollup.arbitrum.io/rpc",
      accounts: [process.env.WALLET_PRIVATE_KEY],
    },
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
    showMethodSig: true,
  },
  etherscan: {
    apiKey: {
      arbitrumOne: process.env.ETHERSCAN_API_KEY,
      arbitrumGoerli: process.env.ETHERSCAN_API_KEY,
      arbitrumTestnet: process.env.ETHERSCAN_API_KEY, //same key for test and mainnet
    },
  },
};

task(
  "flat",
  "Flattens and prints contracts and their dependencies (Resolves licenses)"
)
  .addOptionalVariadicPositionalParam(
    "files",
    "The files to flatten",
    undefined,
    types.inputFile
  )
  .setAction(async ({ files }, hre) => {
    let flattened = await hre.run("flatten:get-flattened-sources", { files });

    // Remove every line started with "// SPDX-License-Identifier:"
    flattened = flattened.replace(
      /SPDX-License-Identifier:/gm,
      "License-Identifier:"
    );
    flattened = `// SPDX-License-Identifier: MIXED\n\n${flattened}`;

    // Remove every line started with "pragma experimental ABIEncoderV2;" except the first one
    flattened = flattened.replace(
      /pragma experimental ABIEncoderV2;\n/gm,
      (
        (i) => (m) =>
          !i++ ? m : ""
      )(0)
    );
    console.log(flattened);
  });
