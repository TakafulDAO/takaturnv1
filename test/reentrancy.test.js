const assert = require('assert');
const hre = require("hardhat");
const Web3 = require("web3");
const web3 = new Web3(hre.network.provider); // hre.network.provider is an EIP1193-compatible provider.
const ERC20abi = require('erc-20-abi');

const compiledFund = require('../artifacts/ethereum/contracts/Fund.sol/Fund.json');
const compiledFactory = require('../artifacts/ethereum/contracts/TakaturnFactory.sol/TakaturnFactory.json');
const compiledCollateral = require('../artifacts/ethereum/contracts/Collateral.sol/Collateral.json');

const compiledAttackContract = require('../artifacts/ethereum/contracts/ReentrancyTest.sol/ReentrancyTest.json');

const { eventNames } = require('process');
const { start } = require('repl');
const { exec } = require('child_process');

let accounts = [];
let fund;
let usdc;
let collateral;

// part 1
let totalParticipants = 12;
let cycleTime = 60;
let contributionAmount = 5;
let contributionPeriod = 40;
let collateralFundingPeriod = 604800;
let collateralAmount = 60;

const locallyManipulatedBalance = 10000 * 10 ** 6;

//global
const USDC_ADDRESS = "0x07865c6E87B9F70255377e024ace6630C1Eaa37F";
const USDC_SLOT = 9;

// Function which allows to convert any address to the signer which can sign transactions in a test
async function updateBalance(address) {
    let userAddress = address;

    // Get storage slot index
    const index = web3.utils.soliditySha3(
        {type: 'uint256', value: userAddress}, 
        {type: 'uint256', value: USDC_SLOT}
    );

    // Manipulate local balance (needs to be bytes32 string)
    await hre.network.provider.send( //is there a web3 eq?
        "hardhat_setStorageAt",
        [
            USDC_ADDRESS, //usdc.options.address
            index, //.toString(),
            web3.utils.toHex(web3.utils.padLeft(locallyManipulatedBalance, 64))
        ]
    );
  }

// Function to increase time in mainnet fork
async function increaseTime(value) {
    if (!ethers.BigNumber.isBigNumber(value)) {
      value = ethers.BigNumber.from(value);
    }
    await ethers.provider.send('evm_increaseTime', [value.toNumber()]);
    await ethers.provider.send('evm_mine');
}

async function everyonePaysAndCloseCycle() {

  await usdc.methods.approve(fund.options.address, contributionAmount * 10 ** 6).send({ from: attacker });
  await fund.methods.payContributionOnBehalfOf(attack.options.address).send({ from: attacker });

  for (let i = 1; i < totalParticipants; i++) {
      await usdc.methods.approve(fund.options.address, contributionAmount * 10 ** 6).send({ from: accounts[i] });
      await fund.methods.payContribution().send({ from: accounts[i] });
  }
  // Artifically increase time to skip the wait
  await network.provider.send("evm_increaseTime", [contributionPeriod + 1]);
  await network.provider.send("evm_mine");
  await fund.methods.closeFundingPeriod().send({
      from: accounts[12]
  });
}

var attacker;
var collateralEth;
describe('reentrancy attack test', function() {
    before(async function() {
      totalParticipants = 2;
      cycleTime = 60;
      contributionAmount = 5;
      contributionPeriod = 40;
      collateralFundingPeriod = 604800;
      collateralAmount = 60;

      accounts = await web3.eth.getAccounts();
  
      // accounts used:
      // 0 - 11: participants
      // 12: fund contract owner
  
      usdc = new web3.eth.Contract(ERC20abi, USDC_ADDRESS); //USDC Polygon Testnet
      
      participants = [];
      for (let i = 0; i < totalParticipants; i++) {
          participants.push(accounts[i]);
      }
  
      factory = await new web3.eth.Contract(compiledFactory.abi)
      .deploy({ data: compiledFactory.bytecode })
      .send({ from: accounts[12], gas: "14000000" });
      
      collateralEth = "0.055"
      // create collateral contract to provide as input
      await factory.methods.createCollateral(totalParticipants, 
                                              cycleTime, 
                                              contributionAmount, 
                                              contributionPeriod, 
                                              collateralAmount,
                                              web3.utils.toWei(collateralEth, "ether"),
                                              "0x07865c6E87B9F70255377e024ace6630C1Eaa37F",
                                              "0xD4a33860578De61DBAbDc8BFdb98FD742fA7028e"
          ).send({ from: accounts[12], gas: "10000000" });
  
      [collateralAddress] = await factory.methods.getDeployedCollaterals().call();
      collateral = await new web3.eth.Contract(compiledCollateral.abi, collateralAddress);

      attacker = accounts[13];
      attack = await new web3.eth.Contract(compiledAttackContract.abi)
        .deploy({ data: compiledAttackContract.bytecode })
        .send({ from: attacker, gas: "14000000" });

      await attack.methods.initializeCollateral(collateral.options.address).send({
        from: attacker
      });

    });

    it("locally manipulates the balance ", async function () {
      for (let i = 1; i < totalParticipants; i++) {
        await updateBalance(accounts[i]);
    }

      await updateBalance(attacker);
      balance = await usdc.methods.balanceOf(attacker).call();
      assert.ok(balance > 0)
  });

  it("joins collateral contract as attacker", async function () {
    balance = await usdc.methods.balanceOf(attacker).call();
    let receipt = await usdc.methods.transfer(attack.options.address, balance.toString()).send({
      from: attacker
    });

    await updateBalance(attacker);

    await attack.methods.depositCollateral().send({
      value: web3.utils.toWei(collateralEth, "ether"), 
      from: attacker
    });  

    for (let i = 1; i < totalParticipants; i++) {
      await collateral.methods.depositCollateral().send({
          value: web3.utils.toWei(collateralEth, "ether"), 
          from: accounts[i]
      });  
    }

    await collateral.methods.initiateFundContract().send({ from: accounts[12], gas: "10000000" });
    
    let newFundAddress = await collateral.methods.fundContract().call();
    fund = await new web3.eth.Contract(compiledFund.abi, newFundAddress); 

    await attack.methods.initializeFund(fund.options.address).send({
      from: attacker
    });

    assert.ok(collateral.methods.isCollateralMember(attack.options.address).call());
  });

  it('makes sure the fund is closed correctly', async function() {
    this.timeout(200000);



    // Close remaining cycles
    while (parseInt(await fund.methods.currentState().call()) < 4) {
      await everyonePaysAndCloseCycle();
      await increaseTime(cycleTime + 1);
      try {
        await fund.methods.startNewCycle().send({
          from: accounts[12]
        });
      }
      catch(e) {}

    }

    let fundClosed = await fund.methods.currentState().call() == 4;
    assert.ok(fundClosed);
  });


  it("is releasing collateral correctly", async function () {
    let releasingCollateral = await collateral.methods.state().call() == 2;
    assert.ok(releasingCollateral);
  });


  it("tries but fails attacking the contract", async function () {
    let balance = attack.methods.getBalance().call();
    try {
      await attack.methods.withdrawCollateral().send({
        from: attacker
      });
    }
    catch (e) {}
    
    assert.ok(balance = attack.methods.getBalance().call());

  });

});
