const assert = require("assert");
const hre = require("hardhat");
const Web3 = require("web3");
const web3 = new Web3(hre.network.provider); // hre.network.provider is an EIP1193-compatible provider.
const ERC20abi = require("erc-20-abi");
const { expect } = require("chai");
const compiledFactory = require("../artifacts/ethereum/contracts/TakaturnFactory.sol/TakaturnFactory.json");
const compiledCollateral = require("../artifacts/ethereum/contracts/Collateral.sol/Collateral.json");
const compiledFund = require("../artifacts/ethereum/contracts/Fund.sol/Fund.json");
const { eventNames } = require("process");

let accounts;
let factory;
let collateralAddress;
let collateral;
let fund;
let USDcInstance; //its not really an instance, its the contract on testnet
let contributionToPay = 10000000; //10$

//Goerli price feed: 0xD4a33860578De61DBAbDc8BFdb98FD742fA7028e
//Mumbai price feed: 0x0715A7794a1dc8e42615F059dD6e406A6594651A
//USDC on Polygon Mumbai: 0x0FA8781a83E46826621b3BC094Ea2A0212e71B23
//USDC on Goerli: 0x07865c6E87B9F70255377e024ace6630C1Eaa37F
describe("Collaterals", () => {
  beforeEach(async () => {
    accounts = await web3.eth.getAccounts();

    factory = await new web3.eth.Contract(compiledFactory.abi)
      .deploy({ data: compiledFactory.bytecode })
      .send({ from: accounts[0], gas: "14000000" });

    //4 users, 2 day cycle, 10$ contribution per cycle, 2 hour funding period, 60$ collateral
    await factory.methods
      .createCollateral(
        "4",
        "172800",
        "10",
        "7200",
        "60",
        web3.utils.toWei("0.055", "ether"),
        "0x07865c6E87B9F70255377e024ace6630C1Eaa37F",
        "0xD4a33860578De61DBAbDc8BFdb98FD742fA7028e"
      )
      .send({
        from: accounts[0],
        gas: "10000000",
      });

    [collateralAddress] = await factory.methods.getDeployedCollaterals().call();
    collateral = await new web3.eth.Contract(
      compiledCollateral.abi,
      collateralAddress
    );
  });

  it("deploys a factory and a collateral instance", () => {
    assert.ok(factory.options.address);
    assert.ok(collateral.options.address);
  });

  it("marks caller as the Collateral owner", async () => {
    const owner = await collateral.methods.owner().call();
    assert.equal(accounts[0], owner);
  });

  // it("converts Eth to USD correctly and vice versa", async () => {
  //   let ETH = "2"; //2 ETH
  //   console.log(
  //     "The value in Wei to convert %s",
  //     web3.utils.toWei(ETH, "ether")
  //   );
  //   let USDAmount = await collateral.methods
  //     ._getToUSDConversionRate(web3.utils.toWei(ETH, "ether"))
  //     .call();

  //   let ETHAmount = await collateral.methods
  //     ._getToEthConversionRate(USDAmount)
  //     .call();

  //   assert.equal(web3.utils.toWei(ETH, "ether"), ETHAmount);

  //   let USD = "10"; //10$

  //   console.log(web3.utils.toWei(USD, "ether"));
  //   ETHAmount = await collateral.methods
  //     ._getToEthConversionRate(web3.utils.toWei(USD, "ether"))
  //     .call();
  //   console.log(ETHAmount);

  //   USDAmount = await collateral.methods
  //     ._getToUSDConversionRate(ETHAmount)
  //     .call();

  //   console.log(USDAmount);
  //   assert.equal(web3.utils.toWei(USD, "ether"), USDAmount); //This fails
  // });

  it("requires a min collateral of ether to enter", async () => {
    try {
      await collateral.methods.depositCollateral().send({
        value: 0,
        from: accounts[1],
      });
      assert(false);
    } catch (err) {
      assert(err);
    }
  });

  it("allows users to deposit a collateral and accepts them as participants", async () => {
    await collateral.methods.depositCollateral().send({
      value: web3.utils.toWei("0.055", "ether"), //atleast 60$
      from: accounts[1],
    });

    const isCollaterized = await collateral.methods
      .isCollateralMember(accounts[1])
      .call();
    assert(isCollaterized);
    const collateralBank = await collateral.methods
      .collateralMembersBank(accounts[1])
      .call();
    assert(collateralBank >= web3.utils.toWei("0.055", "ether"));
  });

  it("checks if a user is under collaterized", async () => {
    await depositCollateral(accounts[1], "0.055");

    const status = await collateral.methods
      .isUnderCollaterized(accounts[1])
      .call();
    assert(!status);

    // let balance = await web3.eth.getBalance(accounts[1]);
    // balance = web3.utils.fromWei(balance,'ether');
    // balance = parseFloat(balance);
    // console.log(balance);
  });

  it("allows users to withdraw collateral in ReleasingCollateral state only", async () => {
    await depositCollateral(accounts[1], "0.055");

    try {
      await withdrawCollateral(accounts[1]);
      assert(false);
    } catch (err) {
      assert(err);
    }

    await collateral.methods.setStateOwner("2").send({
      from: accounts[0],
    });

    await withdrawCollateral(accounts[1]);
    const balance = await collateral.methods
      .collateralMembersBank(accounts[1])
      .call();
    assert(balance == 0);
  });

  it("switchs to CycleOngoing state when members are complete", async () => {
    await depositCollateral(accounts[1], "0.055");
    await depositCollateral(accounts[2], "0.055");
    await depositCollateral(accounts[3], "0.055");
    await depositCollateral(accounts[4], "0.055");

    try {
      await depositCollateral(accounts[5]);
      assert(false);
    } catch (err) {
      assert(err);
    }

    await collateral.methods.initiateFundContract().send({
      from: accounts[0],
    });
    const currentStage = await collateral.methods.state().call();
    assert.equal(currentStage, 1); //cycle ongoing stage
  });

  it("closes the Collateral once all users withdraw", async () => {
    await depositCollateral(accounts[1], "0.055");
    await depositCollateral(accounts[2], "0.055");
    await depositCollateral(accounts[3], "0.055");
    await depositCollateral(accounts[4], "0.055");

    await collateral.methods.setStateOwner("2").send({
      from: accounts[0],
    });

    await withdrawCollateral(accounts[1]);
    await withdrawCollateral(accounts[2]);
    await withdrawCollateral(accounts[3]);
    await withdrawCollateral(accounts[4]);

    const currentStage = await collateral.methods.state().call();
    assert.equal(currentStage, 3); //closed stage
  });

  it("prevents re-enterency to collateral", async () => {
    await depositCollateral(accounts[1], "0.055");

    try {
      await depositCollateral(accounts[1]);
      assert(false);
    } catch (err) {
      assert(err);
    }
  });

  // it("takes contribution of an overcollaterized defaulter and adds it to the beneficiary collateral", async () => {
  //   //4 users, 2 day cycle, 10$ contribution per cycle, 2 hour funding period, 60$ collateral
  //   //1. Deposit Collateral
  //   await depositCollateral(accounts[1], "0.055");
  //   await depositCollateral(accounts[2], "0.055");
  //   await depositCollateral(accounts[3], "0.055");
  //   await depositCollateral(accounts[4], "0.055");

  //   await collateral.methods.initiateFundContract().send({
  //     from: accounts[0],
  //   });

  //   //Request Contribution, assume accounts[3] is selected beneficiary
  //   const defaulters = [accounts[1], accounts[2]];
  //   await collateral.methods.requestContribution(accounts[3], defaulters).send({
  //     from: accounts[0],
  //   });

  //   //check balance of selected beneficiary
  //   let balance = await collateral.methods
  //     .collateralPaymentBank(accounts[3])
  //     .call();
  //   balance = web3.utils.fromWei(balance, "ether");
  //   balance = parseFloat(balance);
  //   assert(balance > 0);

  //   //check balance of defaulters
  //   balance = await collateral.methods
  //     .collateralMembersBank(accounts[1])
  //     .call();
  //   balance = web3.utils.fromWei(balance, "ether");
  //   balance = parseFloat(balance);
  //   assert(balance < 0.055);

  //   //Note on balance above: idealy, use USD to Eth converter to make sure exact amount is deducted
  // });

  it("takes contribution of a a list of defaulters and adds it to the beneficiary collateral", async () => {});

  it("takes contribution of an undercollaterized non-beneficiary defaulter and adds it to the beneficiary collateral", async () => {});
});

let currentCycle;
let currentState;
let lastSelectedBen;

//global
//Goerli USDC: 0x07865c6E87B9F70255377e024ace6630C1Eaa37F //SLOT 9
//Mumbai USDC: 0x0fa8781a83e46826621b3bc094ea2a0212e71b23 //SLOT 0
const USDC_ADDRESS = "0x07865c6E87B9F70255377e024ace6630C1Eaa37F";
const USDC_SLOT = 9;

describe("Collaterals & Fund Integration", () => {
  before(async () => {
    //run once only

    //4 users, 2 day cycle, 10$ contribution per cycle, 2 hour funding period, 60$ collateral
    await factory.methods
      .createCollateral(
        "4",
        "172800",
        "10",
        "7200",
        "60",
        web3.utils.toWei("0.055", "ether"),
        "0x07865c6E87B9F70255377e024ace6630C1Eaa37F",
        "0xD4a33860578De61DBAbDc8BFdb98FD742fA7028e"
      )
      .send({
        from: accounts[0],
        gas: "10000000",
      });

    const addresses = await factory.methods.getDeployedCollaterals().call();
    collateralAddress = addresses[1]; //second collateral contract
    collateral = await new web3.eth.Contract(
      compiledCollateral.abi,
      collateralAddress
    );

    await depositCollateral(accounts[5], "0.055");
    await depositCollateral(accounts[6], "0.055");
    await depositCollateral(accounts[7], "0.055");
    await depositCollateral(accounts[8], "0.055");

    await collateral.methods.initiateFundContract().send({
      from: accounts[0],
    });

    let newFundAddress = await collateral.methods.fundContract().call();
    fund = await new web3.eth.Contract(compiledFund.abi, newFundAddress);

    // web3.eth.defaultAccount = accounts[0];
    // web3.eth.personal.unlockAccount(web3.eth.defaultAccount);

    USDcInstance = new web3.eth.Contract(ERC20abi, USDC_ADDRESS);
  });

  it("Changes USDC user balance for participants", async () => {
    const locallyManipulatedBalance = 100000000; //100$

    let userAddress;
    let balance;
    for (let i = 5; i < 9; i++) {
      userAddress = accounts[i];

      // Get storage slot index
      const index = web3.utils.soliditySha3(
        { type: "uint256", value: userAddress },
        { type: "uint256", value: USDC_SLOT }
      );

      // Manipulate local balance (needs to be bytes32 string)
      await hre.network.provider.send(
        //is there a web3 eq?
        "hardhat_setStorageAt",
        [
          USDC_ADDRESS, //USDcInstance.options.address
          index, //.toString(),
          web3.utils.toHex(web3.utils.padLeft(locallyManipulatedBalance, 64)),
        ]
      );

      // check that the user balance is equal to the expected value
      balance = await USDcInstance.methods.balanceOf(userAddress).call();
      assert.equal(balance, locallyManipulatedBalance.toString());
    }
  });

  it("deploys a Fund instance & creates the USDc JS interface", () => {
    assert.ok(fund.options.address);
    assert.ok(USDcInstance.options.address);
  });

  it("created a collateral instance inside the Fund contract", async () => {
    let collateralInstance = await fund.methods.collateral().call();
    assert.equal(collateralInstance, collateralAddress);
  });

  it("deploys a Fund instance with correct parameters", async () => {
    let colateralValue = await fund.methods.collateral().call();
    assert.equal(colateralValue, collateral.options.address);

    let fundValue = await fund.methods.totalParticipants().call();
    colateralValue = await collateral.methods.totalParticipants().call();

    assert.equal(fundValue, colateralValue);
    //check for other variables here
  });

  it("starts a cycle after fund deployment and sets state to AcceptingContributions", async () => {
    currentCycle = await fund.methods.currentCycle().call();
    assert.equal(currentCycle, 1); //must be the first cycle.

    currentState = await fund.methods.currentState().call();
    assert.equal(currentState, 1); //AcceptingContributions
  });

  it("accepts participants contributions", async () => {
    //Fund Unit Test

    for (let i = 5; i < 9; i++) {
      await USDcInstance.methods
        .approve(fund.options.address, contributionToPay)
        .send({
          //approve 10$
          from: accounts[i],
          gas: "10000000",
        });

      await depositContribution(accounts[i]); //deposit 10$

      const isPaid = await fund.methods.paidThisCycle(accounts[i]).call();
      assert.equal(isPaid, true);
    }
  });

  it("does not accept contribution from non-participants", async () => {
    //Fund unit Test
    await USDcInstance.methods
      .approve(fund.options.address, contributionToPay)
      .send({
        from: accounts[9],
        gas: "10000000",
      });

    try {
      await depositContribution(accounts[9]);
      assert(false);
    } catch (err) {
      assert(err);
    }
  });

  it("does not allow starting a new cycle before the funding period ends", async () => {
    //Fund unit Test
    try {
      await fund.methods.startNewCycle().send({
        from: accounts[0], //TODO: FIX ONWER OF FUND
      });
      assert(false);
    } catch (err) {
      assert(err);
    }
  });

  it("does not close a funding period before the deadline", async () => {
    //Fund unit test
    try {
      await fund.methods.closeFundingPeriod().send({
        from: accounts[0], //TODO: FIX ONWER OF FUND
      });
      assert(false);
    } catch (err) {
      assert(err);
    }
  });

  it("closes a funding period after the deadline", async () => {
    //Fund unit test
    let hours = 2.5 * 3600 + 60; //2.5 hours
    await network.provider.send("evm_increaseTime", [hours]);
    await network.provider.send("evm_mine");

    await fund.methods.closeFundingPeriod().send({
      from: accounts[0], //TODO: FIX ONWER OF FUND
    });

    currentState = await fund.methods.currentState().call();
    assert.equal(currentState, 3); //cycle ongoing. It feels like selecting ben is an internal state becaseu i cannot check for it
  });

  it("selects a beneficiary correctly", async () => {
    let count = 0;
    let bool = false;
    for (let i = 5; i < 9; i++) {
      bool = await fund.methods.isBeneficiary(accounts[i]).call();
      if (bool) {
        count++;
        lastSelectedBen = accounts[i];
      }
    }
    assert.equal(count, 1);

    let balance = await fund.methods.beneficiariesPool(lastSelectedBen).call();
    assert(balance >= 40); //atleast 40$
  });

  // it("does not set participants as defaulters", async () => { //Fund Unit Test
  //     const defaulters = await fund.methods.defaulters("0").call();
  //     //console.log(defaulters);

  //     //assert.ok(!defaulters.length); //array should be empty
  // });

  it("allows the selected beneficiary to withdraw the contribution", async () => {
    await fund.methods.withdrawFund().send({
      from: lastSelectedBen,
    });

    //check if pool equal to 0
    //check if USDC was incremented accordingly
  });

  it("does not allow non-selected participants to withdraw the contribution", async () => {
    try {
      await fund.methods.claimFund().send({
        from: accounts[6], //I know that account 5 is the selected account
      });
      assert(false);
    } catch (err) {
      assert(err);
    }
  });

  it("only starts a new cycle after cycle duration has passed", async () => {
    //Fund unit Test
    let days = 48.5 * 3600; //> 2 day
    await network.provider.send("evm_increaseTime", [days]);
    await network.provider.send("evm_mine");

    await fund.methods.startNewCycle().send({
      from: accounts[0], //TODO: FIX ONWER OF FUND
    });

    currentCycle = await fund.methods.currentCycle().call();
    assert(currentCycle, 2);
  });

  //   it("successfully completes a fund term consisting of 4 uers", async () => {
  //     while (state != 5) {
  //       currentState = await fund.methods.currentState().call();
  //       for (let i = 5; i < 9; i++) {
  //         await USDcInstance.methods.approve(fund.options.address, 10).send({ //needs to be contributionToPay
  //           //approve 10$
  //           from: accounts[i],
  //           gas: "10000000",
  //         });

  //         await depositContribution(accounts[i]); //deposit 10$

  //         const isPaid = await fund.methods.paidThisCycle(accounts[i]).call();
  //         assert.equal(isPaid, true);
  //       }

  //       let hours = 2.5 * 3600 + 60; //2.5 hours
  //       await network.provider.send("evm_increaseTime", [hours]);
  //       await network.provider.send("evm_mine");

  //       await fund.methods.closeFundingPeriod().send({
  //         from: accounts[0], //TODO: FIX ONWER OF FUND
  //       });
  //     }
  //     currentCycle = await fund.methods.currentCycle().call();
  //     //console.log(currentCycle);
  //   });
});

//Edge case tests
//it defaults a user who has not paid, after the funding period ended

// // Artifically increase time to skip the wait
// await network.provider.send("evm_increaseTime", [20]);
// await network.provider.send("evm_mine");

const depositCollateral = async (address, value) => {
  await collateral.methods.depositCollateral().send({
    value: web3.utils.toWei(value, "ether"),
    from: address,
  });
};

const withdrawCollateral = async (address) => {
  await collateral.methods.withdrawCollateral().send({
    from: address,
  });
};

const depositContribution = async (address) => {
  await fund.methods.payContribution().send({
    from: address,
  });
};

// //from: https://mixbytes.io/blog/modify-ethereum-storage-hardhats-mainnet-fork#rec482752067

// function getSlot(userAddress, mappingSlot) {
//     return web3.utils.soliditySha3(
//         {type: 'uint256', value: userAddress},
//         {type: 'uint256', value: mappingSlot}
//     )
// }

// async function checkSlot(erc20, mappingSlot) {
//     const contractAddress = erc20.address
//     const userAddress = web3.constants.ADDRESS_ZERO

//     // console.log("i am here inside checkslot");

//     // the slot must be a hex string stripped of leading zeros! no padding!
//     // https://ethereum.stackexchange.com/questions/129645/not-able-to-set-storage-slot-on-hardhat-network
//     const balanceSlot = getSlot(userAddress, mappingSlot)

//     // storage value must be a 32 bytes long padded with leading zeros hex string
//     const value = 0xDEADBEEF
//     const storageValue = web3.utils.toHex(web3.utils.padLeft(value, 32))
//     //const storageValue = ethers.utils.hexlify(ethers.utils.zeroPad(value, 32))

//     await hre.network.provider.send(
//         "hardhat_setStorageAt",
//         [
//             contractAddress,
//             balanceSlot,
//             storageValue
//         ]
//     )
//     return await erc20.balanceOf(userAddress) == value //Aisha: this is always returning false
// }

// async function findBalanceSlot(erc20) {
//     const snapshot = await hre.network.provider.send("evm_snapshot")
//     console.log(snapshot);
//     for (let slotNumber = 0; slotNumber < 100; slotNumber++) {
//         try {
//             if (await checkSlot(erc20, slotNumber)) {
//                 await hre.network.provider.send("evm_revert", [snapshot])
//                 console.log('found a slot number');
//                 return slotNumber
//             }
//         } catch { }
//         await hre.network.provider.send("evm_revert", [snapshot])
//     }
//     console.log("hello there");
// }

// function getSlot(userAddress, mappingSlot) {
//     return ethers.utils.solidityKeccak256(
//         ["uint256", "uint256"],
//         [userAddress, mappingSlot]
//     )
// }

// async function checkSlot(erc20, mappingSlot) {
//     const contractAddress = erc20.address
//     const userAddress = ethers.constants.AddressZero

//     // the slot must be a hex string stripped of leading zeros! no padding!
//     // https://ethereum.stackexchange.com/questions/129645/not-able-to-set-storage-slot-on-hardhat-network
//     const balanceSlot = getSlot(userAddress, mappingSlot)

//     // storage value must be a 32 bytes long padded with leading zeros hex string
//     const value = 0xDEADBEEF
//     const storageValue = ethers.utils.hexlify(ethers.utils.zeroPad(value, 32))

//     await ethers.provider.send(
//         "hardhat_setStorageAt",
//         [
//             contractAddress,
//             balanceSlot,
//             storageValue
//         ]
//     )
//     return await erc20.balanceOf(userAddress) == value
// }

// async function findBalanceSlot(erc20) {
//     const snapshot = await network.provider.send("evm_snapshot")
//     for (let slotNumber = 0; slotNumber < 100; slotNumber++) {
//         try {
//             if (await checkSlot(erc20, slotNumber)) {
//                 await ethers.provider.send("evm_revert", [snapshot])
//                 return slotNumber
//             }
//         } catch { }
//         await ethers.provider.send("evm_revert", [snapshot])
//     }
// }

// it("Change USDC user balance", async function() {
//     const usdcAddress = "0x0fa8781a83e46826621b3bc094ea2a0212e71b23";
//     const usdc = await ethers.getContractAt("IERC20", usdcAddress)
//     const [signer] = await ethers.getSigners()
//     const signerAddress = accounts[6]; //await signer.getAddress()

//     // automatically find mapping slot
//     const mappingSlot = await findBalanceSlot(usdc)
//     console.log("Found USDC.balanceOf slot: ", mappingSlot)

//     // calculate balanceOf[signerAddress] slot
//     const signerBalanceSlot = getSlot(signerAddress, mappingSlot)

//     // set it to the value
//     const value = 123456789
//     await ethers.provider.send(
//         "hardhat_setStorageAt",
//         [
//             usdc.address,
//             signerBalanceSlot,
//             ethers.utils.hexlify(ethers.utils.zeroPad(value, 32))
//         ]
//     )

//     // check that the user balance is equal to the expected value
//     expect(await usdc.balanceOf(signerAddress)).to.be.eq(value)
// })
