const assert = require('assert');
const hre = require("hardhat");
const Web3 = require("web3");
const web3 = new Web3(hre.network.provider); // hre.network.provider is an EIP1193-compatible provider.
const ERC20abi = require('erc-20-abi');
const path = require('path');
const ExcelJS = require("exceljs");
const fs = require("fs");

const compiledFund = require('../artifacts/ethereum/contracts/Fund.sol/Fund.json');
const compiledFactory = require('../artifacts/ethereum/contracts/TakaturnFactory.sol/TakaturnFactory.json');
const compiledCollateral = require('../artifacts/ethereum/contracts/Collateral.sol/Collateral.json');

const compiledFundSimulation = require('../artifacts/ethereum/contracts/Fund_simulation.sol/Fund_sim.json');
const compiledFactorySimulation = require('../artifacts/ethereum/contracts/TakaturnFactory_simulation.sol/TakaturnFactory_sim.json');
const compiledCollateralSimulation = require('../artifacts/ethereum/contracts/Collateral_simulation.sol/Collateral_sim.json');

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

const locallyManipulatedBalance = 1000 * 10 ** 6;

const states = {
    0 : "InitializingFund",
    1 : "AcceptingContributions",
    2 : "ChoosingBeneficiary",
    3 : "CycleOngoing",
    4 : "FundClosedCyclesFinished",
    5 : "FundClosedEveryoneDefaulted"
}


let currentCycle;
let currentState;

//global
const USDC_ADDRESS = "0x07865c6E87B9F70255377e024ace6630C1Eaa37F";
const USDC_SLOT = 9;

function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}

async function everyonePaysAndCloseCycle() {
    for (let i = 0; i < totalParticipants; i++) {
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

async function executeCycle(defaultersAmount = 0, specificDefaultersIndices = [], withdrawFund = true) {
    let randomDefaulterIndices = specificDefaultersIndices;

    let currentCycle = parseInt(await fund.methods.currentCycle().call());
    //console.log(currentCycle); 

    while (defaultersAmount != randomDefaulterIndices.length) {
        if (defaultersAmount > totalParticipants) {
            //console.log("Too many defaulters specified!");
            break;
        }
        let randomInt = getRandomInt(Math.floor(totalParticipants - 1))
        
        if (!randomDefaulterIndices.includes(randomInt)) {
            //console.log("Defaulting user..");
            randomDefaulterIndices.push(randomInt)
        }
    }

    //console.log(randomDefaulterIndices);

    let paidAmount = 0 ;
    for (let i = 0; i < totalParticipants; i++) {

        if (randomDefaulterIndices.includes(i)) {
            continue;
        }
        else {
            try {
                await usdc.methods.approve(fund.options.address, contributionAmount * 10 ** 6).send({
                    from: accounts[i]
                });
        
                await fund.methods.payContribution().send({
                    from: accounts[i]
                });
    
                paidAmount++;
            }
            catch (e) {}

        }

    }

    // Artifically increase time to skip the wait
    await network.provider.send("evm_increaseTime", [contributionPeriod + 1]);
    await network.provider.send("evm_mine");

    await fund.methods.closeFundingPeriod().send({
        from: accounts[12]
    });

    let state = await fund.methods.currentState().call();
    assert.ok(state != 1); // state is not equal to acceptingContributions

    let fundClaimed = false;
    let claimant;
    let previousBalanceClaimant = 0;
    let poolEmpty = 0;
    if (withdrawFund) {
        for (let i = 0; i < totalParticipants; i++) {
            try {
                claimant = accounts[i];
                previousBalanceClaimant = await usdc.methods.balanceOf(claimant).call();
                await fund.methods.withdrawFund().send({
                    from: accounts[i]
                });
                //console.log("Fund claimed by: " + i);
                fundClaimed = true
                break;
            }
            catch (e) {}
        }

        poolEmpty = await fund.methods.beneficiariesPool(claimant).call();
    }


    let poolEmptyOk = poolEmpty == 0

    if (!fundClaimed) {
        assert.ok(true);
    }
    else {
        assert.ok(fundClaimed);
        assert.ok(poolEmptyOk);
    }

    // Artifically increase time to skip the wait
    await network.provider.send("evm_increaseTime", [cycleTime + 1]);
    await network.provider.send("evm_mine");

  
    //await makeExcelSheet();

    try {
        await fund.methods.startNewCycle().send({
            from: accounts[12]
        });
    }
    catch (e) {}

    let newCycle = parseInt(await fund.methods.currentCycle().call());


    //console.log(newCycle);

    let newCycleStarted = (currentCycle + 1) == newCycle;
    //console.log(newCycleStarted);
    //console.log(await fund.methods.currentState().call());
    let fundClosed = parseInt(await fund.methods.currentState().call()) == 4 || parseInt(await fund.methods.currentState().call()) == 5; // FundClosed
    if (fundClosed) {
        assert.ok(true);
    }
    else {
        assert.ok(newCycleStarted); 
    }

}

describe('Takaturn Collateral & Fund Part 1', function() {
    beforeEach(async function() {
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
        
        // create collateral contract to provide as input
        await factory.methods.createCollateral(totalParticipants, 
                                                cycleTime, 
                                                contributionAmount, 
                                                contributionPeriod, 
                                                collateralAmount,
                                                web3.utils.toWei("0.055", "ether"),
                                                "0x07865c6E87B9F70255377e024ace6630C1Eaa37F",
                                                "0xD4a33860578De61DBAbDc8BFdb98FD742fA7028e"
            ).send({ from: accounts[12], gas: "10000000" });
    
        [collateralAddress] = await factory.methods.getDeployedCollaterals().call();
        collateral = await new web3.eth.Contract(compiledCollateral.abi, collateralAddress);
    
        for (let i = 0; i < totalParticipants; i++) {
            await collateral.methods.depositCollateral().send({
                value: web3.utils.toWei("0.055", "ether"), 
                from: accounts[i]
            });
        }

        await collateral.methods.initiateFundContract().send({ from: accounts[12], gas: "10000000" });

        let newFundAddress = await collateral.methods.fundContract().call();
        fund = await new web3.eth.Contract(compiledFund.abi, newFundAddress); 

        let userAddress;
        for(let i = 0; i < totalParticipants; i++) {
            userAddress = accounts[i];

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
    });

    it('changes USDC user balance for participants', async function() {
        let address;
        let balance;
        for(let i = 0; i < totalParticipants; i++) {
            address = accounts[i];
            balance = await usdc.methods.balanceOf(address).call();
            assert.equal(balance, locallyManipulatedBalance.toString());
        }     
    });

    it('deploys a Fund instance with correct parameters & creates the USDC JS interface', async function() {
        assert.ok(fund.options.address);
        assert.ok(usdc.options.address);

        let collateralValue = await fund.methods.collateral().call();
        assert.equal(collateralValue, collateral.options.address);

        let fundValue = await fund.methods.totalParticipants().call();
        collateralValue = await collateral.methods.totalParticipants().call();

        assert.equal(fundValue, collateralValue);
        //check for other variables here
    });
    
    it('adds participants', async function() {
        let lastAddress = await fund.methods.beneficiariesOrder(totalParticipants - 1).call();
        assert.ok(lastAddress == accounts[totalParticipants - 1]);
    });

    it('matches participants based on the collateral order', async function() {
        let ok = false;
        for (let i = 0; i < totalParticipants; i++) {
            let fundAddress = await fund.methods.beneficiariesOrder(i).call();
            let collateralAddress = await collateral.methods.participants(i).call();
            if (fundAddress == collateralAddress) {
                ok = true;
                break;
            }
        }

        assert.ok(ok);
    });

    it('starts a new cycle upon deploy', async function() {
        let currentCycle = await fund.methods.currentCycle().call();
        //console.log(currentCycle);
        assert.ok(currentCycle == 1);
    });

    it('cannot start a new cycle while an existing cycle is going', async function() {
        let currentCycle = await fund.methods.currentCycle().call();
        try {
            await fund.methods.startNewCycle().send({
                from: accounts[12]
            });
        }
        catch (e) {}
        let newCycle = await fund.methods.currentCycle().call();
        assert.ok(currentCycle == newCycle);
    });

    it('enables participants to pay in USDC and the payments are succesful', async function() {
        for (let i = 0; i < totalParticipants; i++) {
            await usdc.methods.approve(fund.options.address, contributionAmount * 10 ** 6).send({
                from: accounts[i]
            });
            
        
            await fund.methods.payContribution().send({
                from: accounts[i]
            });
        }

        assert.ok(await fund.methods.paidThisCycle(accounts[0]).call() && await usdc.methods.balanceOf(fund.options.address).call() == contributionAmount * 10 ** 6 * totalParticipants);
    });

    it('can close the funding period after the given time', async function() {
        for (let i = 0; i < totalParticipants; i++) {
            await usdc.methods.approve(fund.options.address, contributionAmount * 10 ** 6).send({
                from: accounts[i]
            });
            
        
            await fund.methods.payContribution().send({
                from: accounts[i]
            });
        }

        let closeBeforeTime = true;
        let state = await fund.methods.currentState().call();
        try {
            await fund.methods.closeFundingPeriod().send({
                from: accounts[12]
            });
        }
        catch (e) {
            state = await fund.methods.currentState().call();
            //console.log("Did not close funding period!")
            //console.log(states[state]);
            closeBeforeTime = state != 1 // acceptingContributions;
        }

        // Artifically increase time to skip the wait
        await network.provider.send("evm_increaseTime", [contributionPeriod + 1]);
        await network.provider.send("evm_mine");

        state = await fund.methods.currentState().call();
        //console.log(states[state]);

        await fund.methods.closeFundingPeriod().send({
            from: accounts[12]
        });

        
        state = await fund.methods.currentState().call();
        //console.log(states[state]);

        let closeAfterTime = state != 1 // acceptingContributions;

        assert.ok(!closeBeforeTime && closeAfterTime);
    });

    it('can have participants autopay at the end of the funding period', async function() {
        for (let i = 0; i < totalParticipants; i++) {
            await usdc.methods.approve(fund.options.address, contributionAmount * 10 ** 6 * totalParticipants).send({
                from: accounts[i]
            });
        
            await fund.methods.toggleAutoPay().send({
                from: accounts[i]
            });
        }

        // Artifically increase time to skip the wait
        await network.provider.send("evm_increaseTime", [contributionPeriod + 1]);
        await network.provider.send("evm_mine");

        await fund.methods.closeFundingPeriod().send({
            from: accounts[12]
        });

        for (let i = 0; i < totalParticipants; i++) {
            assert.ok(await fund.methods.paidThisCycle(accounts[i]).call());
        }
    });
    
    // This happens in the 1st cycle
    it('rewards beneficiaries based on a first come first served basis', async function() {
        await everyonePaysAndCloseCycle();

        let supposedBeneficiary = await fund.methods.beneficiariesOrder(0).call();
        let actualBeneficiary = await fund.methods.lastBeneficiary().call();
        assert.ok(supposedBeneficiary == actualBeneficiary);
    });

    // This happens in the 1st cycle
    it('allows the beneficiary to claim the fund', async function() {
        await everyonePaysAndCloseCycle();
        let success = false;
        try {
            await fund.methods.withdrawFund().send({
                from: accounts[0]
            });
            success = true;
        }
        catch (e) {}

        assert.ok(success);
    });

    // This happens in the 1st cycle
    it('allows the beneficiary to claim the collateral from defaulters', async function() {
        this.timeout(200000);

        // Everyone pays but last 2 participants
        for (let i = 0; i < totalParticipants - 2; i++) {
            await usdc.methods.approve(fund.options.address, contributionAmount * 10 ** 6).send({ from: accounts[i] });
            await fund.methods.payContribution().send({ from: accounts[i] });
        }

        // Artifically increase time to skip the wait
        await network.provider.send("evm_increaseTime", [contributionPeriod + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.closeFundingPeriod().send({
            from: accounts[12]
        });

        currentBalance = await web3.eth.getBalance(accounts[0]);

        try {
            await fund.methods.withdrawFund().send({
                from: accounts[0]
            });
        }
        catch (e) {}

        newBalance = await web3.eth.getBalance(accounts[0]);
        assert.ok(newBalance > currentBalance);

    });

    it('does not move the order of beneficiaries of previous cycles if they default in future cycles', async function() {
        this.timeout(200000);

        await everyonePaysAndCloseCycle();
        await network.provider.send("evm_increaseTime", [cycleTime + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.startNewCycle().send({
            from: accounts[12]
        });
        
        let firstBeneficiary = await fund.methods.beneficiariesOrder(0).call();
        await executeCycle(1, [0]);
        let firstBeneficiaryAfterDefault = await fund.methods.beneficiariesOrder(0).call();
    
        assert.ok(firstBeneficiary == firstBeneficiaryAfterDefault);
    });

    // This happens in the 1st cycle
    it('moves the order of beneficiaries if the supposed beneficiary of this cycle defaults', async function() {
        this.timeout(200000);
        let supposedBeneficiary = await fund.methods.beneficiariesOrder(0).call();

        // Everyone pays but the first participant, which should be the first beneficiary
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

        let supposedBeneficiaryAfterDefault = await fund.methods.beneficiariesOrder(0).call();
        let supposedBeneficiaryNewPosition = await fund.methods.beneficiariesOrder(1).call();
        assert.ok(supposedBeneficiary != supposedBeneficiaryAfterDefault);
        assert.ok(supposedBeneficiary == supposedBeneficiaryNewPosition);
    });

    // This happens in the 1st cycle
    it('moves multiple defaulters in a row to after the first elligible beneficiary', async function() {
        this.timeout(200000);
        let supposedBeneficiaryOrder = [accounts[3], accounts[0], accounts[1], accounts[2], accounts[4]]

        // Everyone pays but the first participant, which should be the first beneficiary
        for (let i = 3; i < totalParticipants; i++) {
            await usdc.methods.approve(fund.options.address, contributionAmount * 10 ** 6).send({ from: accounts[i] });
            await fund.methods.payContribution().send({ from: accounts[i] });
        }
        // Artifically increase time to skip the wait
        await network.provider.send("evm_increaseTime", [contributionPeriod + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.closeFundingPeriod().send({
            from: accounts[12]
        });

        for (let i = 0; i < supposedBeneficiaryOrder.length; i++) {
            assert.ok(supposedBeneficiaryOrder[i] == await fund.methods.beneficiariesOrder(i).call());
        }

        // Check if the moved order is actually applied as well
        assert.ok(accounts[3] == await fund.methods.lastBeneficiary().call());
    });

    // This happens in the 1st cycle
    it('does not permit a graced defaulter to withdraw their fund in the current cycle', async function() {
        this.timeout(200000);
        let supposedBeneficiary = await fund.methods.beneficiariesOrder(0).call();

        // Everyone pays but the first participant, which should be the first beneficiary
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

        let supposedBeneficiaryAfterDefault = await fund.methods.beneficiariesOrder(0).call();
        let supposedBeneficiaryNewPosition = await fund.methods.beneficiariesOrder(1).call();
        assert.ok(supposedBeneficiary != supposedBeneficiaryAfterDefault);
        assert.ok(supposedBeneficiary == supposedBeneficiaryNewPosition);
    });

    it('simulates a whole fund cycle and allows everyone to withdraw after the fund is closed', async function() {
        this.timeout(200000);

        await everyonePaysAndCloseCycle();
        await network.provider.send("evm_increaseTime", [cycleTime + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.startNewCycle().send({
            from: accounts[12]
        });

        await executeCycle(1);
        await executeCycle(6);

        await executeCycle(1);
        await executeCycle(6);

        await executeCycle(5);
        await executeCycle(3);

        await executeCycle(2);
        await executeCycle(6);

        await executeCycle(6);
        await executeCycle(8);

        await executeCycle(6);

        for (let i = 0; i < totalParticipants; i++) {
            try {
                await fund.methods.withdrawFund().send({
                    from: accounts[i]
                });
                //console.log("Fund claimed by: " + accounts[i]);
            }
                catch (e) {}
        }

        assert.ok(await usdc.methods.balanceOf(fund.options.address).call() == 0);
    });
/* deprecated
    it('makes sure the participants array is empty after the fund is closed', async function() {
        this.timeout(200000);

        await everyonePaysAndCloseCycle();
        await network.provider.send("evm_increaseTime", [cycleTime + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.startNewCycle().send({
            from: accounts[12]
        });

        // Close remaining cycles
        while (parseInt(await fund.methods.currentState().call()) < 4) {
            await executeCycle();
        }

        let arrayEmpty = false;
        try {
            await fund.methods.participants(0).call();
        }
        catch (e) {
            arrayEmpty = true;
        }

        assert.ok(arrayEmpty);
    });*/

    it('makes sure the fund is closed correctly', async function() {
        this.timeout(200000);

        await everyonePaysAndCloseCycle();
        await network.provider.send("evm_increaseTime", [cycleTime + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.startNewCycle().send({
            from: accounts[12]
        });

        // Close remaining cycles
        while (parseInt(await fund.methods.currentState().call()) < 4) {
            await executeCycle();
        }

        let fundClosed = await fund.methods.currentState().call() == 4;
        assert.ok(fundClosed);
    });


    it('allows owner to withdraw any unclaimed funds after 180 days, but not earlier', async function() {
        this.timeout(200000);

        await everyonePaysAndCloseCycle();
        await network.provider.send("evm_increaseTime", [cycleTime + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.startNewCycle().send({
            from: accounts[12]
        });

        let balance = 0;
        // Attempt to withdraw while cycles are ongoing, this should fail
        try {
            fund.methods.emptyFundAfterEnd().send({
                from: accounts[12]
            });
            
        }
        catch(e) {}
        
        balance = await usdc.methods.balanceOf(fund.options.address).call();
        assert.ok(balance > 0);

        // Close remaining cycles
        while (parseInt(await fund.methods.currentState().call()) < 4) {
            await executeCycle(0, [] ,false);
        }

        // Make sure fund is closed
        let fundClosed = await fund.methods.currentState().call() == 4;
        assert.ok(fundClosed);

        // Attempt to withdraw after last cycle, this should fail
        try {
            fund.methods.emptyFundAfterEnd().send({
                from: accounts[12]
            });
        }
        catch(e) {}

        balance = await usdc.methods.balanceOf(fund.options.address).call();
        assert.ok(balance > 0);

        // Artifically increase time to skip the long wait of 180 days
        await network.provider.send("evm_increaseTime", [180 * 24 * 60 * 60 + 1]);
        await network.provider.send("evm_mine");

        // Attempt to withdraw after 180 days
        try {
            fund.methods.emptyFundAfterEnd().send({
                from: accounts[12]
            });
        }
        catch(e) {}

        balance = await usdc.methods.balanceOf(fund.options.address).call();
        assert.ok(balance == 0);
    });

    // This happens in the 1st cycle
    it('returns remaining cycle time properly', async function() {
        this.timeout(200000);

        let fundStart = await fund.methods.fundStart().call();
        let currentRemainingCycleTime = await fund.methods.getRemainingCycleTime().call();
        let currentCycle = await fund.methods.currentCycle().call();
        console.log("current remaning cycle time:", currentRemainingCycleTime);
        console.log((cycleTime * currentCycle + fundStart));

        assert.ok(cycleTime == currentRemainingCycleTime);
        // Artifically increase time to skip the wait
        await network.provider.send("evm_increaseTime", [contributionPeriod + 1]);
        await network.provider.send("evm_mine");

        let newRemainingCycleTime = await fund.methods.getRemainingCycleTime().call();
        console.log("new remaning cycle time:", newRemainingCycleTime);
        assert.ok((currentRemainingCycleTime - newRemainingCycleTime) == contributionPeriod + 1);

        assert.ok(((cycleTime * currentCycle + fundStart) - currentRemainingCycleTime) > 0);
        // Artifically increase time to skip the wait
        await network.provider.send("evm_increaseTime", [cycleTime + 1]);
        await network.provider.send("evm_mine");

        newRemainingCycleTime = await fund.methods.getRemainingCycleTime().call();

        assert.ok(newRemainingCycleTime == 0);
        
    });

    // This happens in the 1st cycle
    it('returns remaining contribution time properly', async function() {
        this.timeout(200000);

        let fundStart = await fund.methods.fundStart().call();
        let currentCycle = await fund.methods.currentCycle().call(); 
        let contributionEndTimestamp = parseInt(cycleTime * (currentCycle - 1) + fundStart + contributionPeriod);
        let currentRemainingContributionTime = await fund.methods.getRemainingContributionTime().call();
        //console.log("fundStart", fundStart);
        //console.log("contribution end timestamp", contributionEndTimestamp);
        //console.log("current remaning contribution time:", currentRemainingContributionTime);
        //console.log("answer", fundStart + currentRemainingContributionTime);
        assert.ok(fundStart + currentRemainingContributionTime == contributionEndTimestamp);

        // Artifically increase time to skip the wait
        await network.provider.send("evm_increaseTime", [contributionPeriod * 0.5]);
        await network.provider.send("evm_mine");

        let newRemainingContributionTime = await fund.methods.getRemainingContributionTime().call();
        //console.log("new remaning contribution time:", newRemainingContributionTime);
        assert.ok(newRemainingContributionTime == contributionPeriod * 0.5);

        // Artifically increase time to skip the wait
        await network.provider.send("evm_increaseTime", [contributionPeriod]);
        await network.provider.send("evm_mine");

        newRemainingContributionTime = await fund.methods.getRemainingContributionTime().call();
        //console.log("new remaning contribution time:", newRemainingContributionTime);
        assert.ok(newRemainingContributionTime == 0);  
    });
});


// part 2
describe('Takaturn Collateral & Fund Part 2', function() {
    beforeEach(async function() {
        totalParticipants = 12;
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
    
        factory = await new web3.eth.Contract(compiledFactorySimulation.abi)
        .deploy({ data: compiledFactorySimulation.bytecode })
        .send({ from: accounts[12], gas: "14000000" });

        let collateralEth = "0.055"
        
        // create collateral contract to provide as input
        await factory.methods.createCollateral(totalParticipants, 
                                                cycleTime, 
                                                contributionAmount, 
                                                contributionPeriod, 
                                                collateralAmount,
                                                web3.utils.toWei(collateralEth, "ether"), // low eth collateral to make sure
                                                "0x07865c6E87B9F70255377e024ace6630C1Eaa37F",
                                                "0xD4a33860578De61DBAbDc8BFdb98FD742fA7028e"
            ).send({ from: accounts[12], gas: "10000000" });
    
        [collateralAddress] = await factory.methods.getDeployedCollaterals().call();
        collateral = await new web3.eth.Contract(compiledCollateralSimulation.abi, collateralAddress);

        await collateral.methods.setSimulationEthPrice(web3.utils.toWei(Number(1500).toString(), "ether")).send({
            from: accounts[12]
        });

        for (let i = 0; i < totalParticipants; i++) {
            await collateral.methods.depositCollateral().send({
                value: web3.utils.toWei(collateralEth, "ether"), 
                from: accounts[i]
            });
        }

        await collateral.methods.initiateFundContract().send({ from: accounts[12], gas: "10000000" });

        await collateral.methods.setSimulationEthPrice(web3.utils.toWei(Number(750).toString(), "ether")).send({
            from: accounts[12]
        });
        
        let newFundAddress = await collateral.methods.fundContract().call();
        fund = await new web3.eth.Contract(compiledFundSimulation.abi, newFundAddress); 

        let userAddress;
        for(let i = 0; i < totalParticipants; i++) {
            userAddress = accounts[i];

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
    });

    it('reduces the no. of cycles if a non-beneficiary user is expelled', async function() {
        this.timeout(200000);
        await everyonePaysAndCloseCycle();
        await network.provider.send("evm_increaseTime", [cycleTime + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.startNewCycle().send({
            from: accounts[12]
        });

        let startingCycles = await fund.methods.totalAmountOfCycles().call();

        // We let the participant 3 default constantly, before becoming beneficiary
        while (await collateral.methods.isCollateralMember(accounts[2]).call()) {
            if (parseInt(await fund.methods.currentState().call()) == 4 ||
                parseInt(await fund.methods.currentState().call()) == 5) {
                break;
            }
            await executeCycle(1, [2]);
        }

        assert.ok(await fund.methods.totalAmountOfCycles().call() < startingCycles);
    });

    it('does not reduce the no. of cycles if a past beneficiary is expelled', async function() {
        this.timeout(200000);
        await everyonePaysAndCloseCycle();
        await network.provider.send("evm_increaseTime", [cycleTime + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.startNewCycle().send({
            from: accounts[12]
        });

        let startingCycles = await fund.methods.totalAmountOfCycles().call();

        // We let the participant 1 default constantly, before becoming beneficiary
        while (await collateral.methods.isCollateralMember(accounts[0]).call()) {
            if (parseInt(await fund.methods.currentState().call()) == 4 ||
                parseInt(await fund.methods.currentState().call()) == 5) {
                break;
            }
            await executeCycle(1, [0]);
        }

        assert.ok(!await collateral.methods.isCollateralMember(accounts[0]).call());
        assert.ok(await fund.methods.totalAmountOfCycles().call() == startingCycles);
    });
 
    it('does not allow defaulted or expelled beneficiaries to withdraw their fund but does allow them to do after the term if closed', async function() {
        this.timeout(200000);
        await everyonePaysAndCloseCycle();
        await network.provider.send("evm_increaseTime", [cycleTime + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.startNewCycle().send({
            from: accounts[12]
        });

        // Set eth price to starting to make sure defaulter doesn't get expelled
        await collateral.methods.setSimulationEthPrice(web3.utils.toWei(Number(1500).toString(), "ether")).send({
            from: accounts[12]
        });

        // Should not be able to withdraw because beneficiary defaulted
        await executeCycle(1, [0]);
        let cannotWithdrawWhenDefaulted = false;
        try {
            await fund.methods.withdrawFund().send({
                from: accounts[0]
            });
        }
        catch (e) {
            cannotWithdrawWhenDefaulted = true;
        }

        // Lower eth price to expel
        await collateral.methods.setSimulationEthPrice(web3.utils.toWei(Number(200).toString(), "ether")).send({
            from: accounts[12]
        });


        await executeCycle(1, [0]);
        let cannotWithdrawWhenExpelled = false;
        try {
            await fund.methods.withdrawFund().send({
                from: accounts[0]
            });
        }
        catch (e) {
            cannotWithdrawWhenExpelled = true;
        }

        // Close remaining cycles
        while (parseInt(await fund.methods.currentState().call()) < 4) {
            await executeCycle(0, [], false);
        }

        let canWithdrawAfterTerm = false;
        try {
            await fund.methods.withdrawFund().send({
                from: accounts[0]
            });
            canWithdrawAfterTerm = true;
        }
        catch (e) {console.log(e)}

        assert.ok(!await collateral.methods.isCollateralMember(accounts[0]).call());

        assert.ok(cannotWithdrawWhenDefaulted);
        assert.ok(cannotWithdrawWhenExpelled);
        assert.ok(canWithdrawAfterTerm);
    });

    it('does not allow defaulted beneficiaries to withdraw their fund, but does allow them if they paid for the next cycle', async function() {
        this.timeout(200000);
        await everyonePaysAndCloseCycle();
        await network.provider.send("evm_increaseTime", [cycleTime + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.startNewCycle().send({
            from: accounts[12]
        });

        // Set eth price to starting to make sure defaulter doesn't get expelled
        await collateral.methods.setSimulationEthPrice(web3.utils.toWei(Number(1500).toString(), "ether")).send({
            from: accounts[12]
        });

        // Should not be able to withdraw because beneficiary defaulted
        await executeCycle(1, [0]);
        let cannotWithdrawWhenDefaulted = false;
        try {
            await fund.methods.withdrawFund().send({
                from: accounts[0]
            });
        }
        catch (e) {
            cannotWithdrawWhenDefaulted = true;
        }

        await everyonePaysAndCloseCycle();
        let canWithdrawAfterPayingNextCycle = false;
        try {
            await fund.methods.withdrawFund().send({
                from: accounts[0]
            });
            canWithdrawAfterPayingNextCycle = true;
        }
        catch (e) {}

        assert.ok(await collateral.methods.isCollateralMember(accounts[0]).call());
        assert.ok(cannotWithdrawWhenDefaulted);
        assert.ok(canWithdrawAfterPayingNextCycle);
    });

    

});


// part 3
describe('Takaturn Collateral & Fund Part 3', function() {
    beforeEach(async function() {
        totalParticipants = 3;
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
        
        // create collateral contract to provide as input
        await factory.methods.createCollateral(totalParticipants, 
                                                cycleTime, 
                                                contributionAmount, 
                                                contributionPeriod, 
                                                collateralAmount,
                                                web3.utils.toWei("0.055", "ether"),
                                                "0x07865c6E87B9F70255377e024ace6630C1Eaa37F",
                                                "0xD4a33860578De61DBAbDc8BFdb98FD742fA7028e"
            ).send({ from: accounts[12], gas: "10000000" });
    
        [collateralAddress] = await factory.methods.getDeployedCollaterals().call();
        collateral = await new web3.eth.Contract(compiledCollateral.abi, collateralAddress);
    
        for (let i = 0; i < totalParticipants; i++) {
            await collateral.methods.depositCollateral().send({
                value: web3.utils.toWei("0.055", "ether"), 
                from: accounts[i]
            });
        }

        await collateral.methods.initiateFundContract().send({ from: accounts[12], gas: "10000000" });

        let newFundAddress = await collateral.methods.fundContract().call();
        fund = await new web3.eth.Contract(compiledFund.abi, newFundAddress); 

        let userAddress;
        for(let i = 0; i < totalParticipants; i++) {
            userAddress = accounts[i];

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
    });

    it('selects graced defaulters as beneficiaries when there are no eligible beneficiaries left', async function() {
        this.timeout(200000);

        // First cycle, participant 1 & 3 pay
        payers = [0, 2]
        for (let i = 0; i < payers.length; i++) {
            await usdc.methods.approve(fund.options.address, contributionAmount * 10 ** 6).send({ from: accounts[payers[i]] });
            await fund.methods.payContribution().send({ from: accounts[payers[i]] });
        }

        // Artifically increase time to skip the wait
        await network.provider.send("evm_increaseTime", [contributionPeriod + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.closeFundingPeriod().send({
            from: accounts[12]
        });

        // Artifically increase time to skip the wait
        await network.provider.send("evm_increaseTime", [cycleTime + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.startNewCycle().send({
            from: accounts[12]
        });

        // Next cycle, only participant 1 pays. Participant 2 and 3 default. Participant 2 should be beneficiary
        await executeCycle(2, [1, 2]);
        
        assert.ok(await fund.methods.isBeneficiary(accounts[1]).call());
    });

    it('does not permit a graced defaulter to withdraw their fund in the current cycle but it allows them to do so if they pay the next cycle', async function() {
        this.timeout(200000);

        // First cycle, participant 1 & 3 pay
        payers = [0, 2]
        for (let i = 0; i < payers.length; i++) {
            await usdc.methods.approve(fund.options.address, contributionAmount * 10 ** 6).send({ from: accounts[payers[i]] });
            await fund.methods.payContribution().send({ from: accounts[payers[i]] });
        }

        // Artifically increase time to skip the wait
        await network.provider.send("evm_increaseTime", [contributionPeriod + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.closeFundingPeriod().send({
            from: accounts[12]
        });

        // Artifically increase time to skip the wait
        await network.provider.send("evm_increaseTime", [cycleTime + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.startNewCycle().send({
            from: accounts[12]
        });

        // Next cycle, only participant 1 pays. Participant 2 and 3 default. Participant 2 should be beneficiary
        await executeCycle(2, [1, 2]);

        // Make sure participant 2 is beneficiary
        assert.ok(await fund.methods.isBeneficiary(accounts[1]).call());

        // Should not be able to withdraw because beneficiary defaulted
        let cannotWithdrawWhenDefaulted = false;
        try {
            await fund.methods.withdrawFund().send({
                from: accounts[1]
            });
        }
        catch (e) {
            cannotWithdrawWhenDefaulted = true;
        }

        // Next cycle, participant 2 pays and can withdraw the fund after paying
        await usdc.methods.approve(fund.options.address, contributionAmount * 10 ** 6).send({ from: accounts[1] });
        await fund.methods.payContribution().send({ from: accounts[1] });

        let canWithdrawAfterPayingNextCycle = false;
        try {
            await fund.methods.withdrawFund().send({
                from: accounts[1]
            });
            canWithdrawAfterPayingNextCycle = true;
        }
        catch (e) {
            console.log(e);
        }

        assert.ok(cannotWithdrawWhenDefaulted);
        assert.ok(canWithdrawAfterPayingNextCycle);

    });
});

// part 4
describe('Takaturn Collateral & Fund Part 4', function() {
    beforeEach(async function() {
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
    
        factory = await new web3.eth.Contract(compiledFactorySimulation.abi)
        .deploy({ data: compiledFactorySimulation.bytecode })
        .send({ from: accounts[12], gas: "14000000" });

        let collateralEth = "0.055"
        
        // create collateral contract to provide as input
        await factory.methods.createCollateral(totalParticipants, 
                                                cycleTime, 
                                                contributionAmount, 
                                                contributionPeriod, 
                                                collateralAmount,
                                                web3.utils.toWei(collateralEth, "ether"), // low eth collateral to make sure
                                                "0x07865c6E87B9F70255377e024ace6630C1Eaa37F",
                                                "0xD4a33860578De61DBAbDc8BFdb98FD742fA7028e"
            ).send({ from: accounts[12], gas: "10000000" });
    
        [collateralAddress] = await factory.methods.getDeployedCollaterals().call();
        collateral = await new web3.eth.Contract(compiledCollateralSimulation.abi, collateralAddress);

        await collateral.methods.setSimulationEthPrice(web3.utils.toWei(Number(1500).toString(), "ether")).send({
            from: accounts[12]
        });

        for (let i = 0; i < totalParticipants; i++) {
            await collateral.methods.depositCollateral().send({
                value: web3.utils.toWei(collateralEth, "ether"), 
                from: accounts[i]
            });
        }

        await collateral.methods.initiateFundContract().send({ from: accounts[12], gas: "10000000" });

        await collateral.methods.setSimulationEthPrice(web3.utils.toWei(Number(750).toString(), "ether")).send({
            from: accounts[12]
        });
        
        let newFundAddress = await collateral.methods.fundContract().call();
        fund = await new web3.eth.Contract(compiledFundSimulation.abi, newFundAddress); 

        let userAddress;
        for(let i = 0; i < totalParticipants; i++) {
            userAddress = accounts[i];

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
    });

    it('does not produce weird behaviour when theres only 2 participants, and one pays and the other doesnt 1', async function() {
        this.timeout(200000);

        // First participant pays, second doesn't
        await usdc.methods.approve(fund.options.address, contributionAmount * 10 ** 6).send({ from: accounts[0] });
        await fund.methods.payContribution().send({ from: accounts[0] });

        // Artifically increase time to skip the wait
        await network.provider.send("evm_increaseTime", [contributionPeriod + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.closeFundingPeriod().send({
            from: accounts[12]
        });
    
        await network.provider.send("evm_increaseTime", [cycleTime + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.startNewCycle().send({
            from: accounts[12]
        });

        // Second participant pays, first doesn't
        await usdc.methods.approve(fund.options.address, contributionAmount * 10 ** 6).send({ from: accounts[1] });
        await fund.methods.payContribution().send({ from: accounts[1] });

        // Artifically increase time to skip the wait
        await network.provider.send("evm_increaseTime", [contributionPeriod + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.closeFundingPeriod().send({
            from: accounts[12]
        });

        assert.ok(await fund.methods.beneficiariesPool(accounts[0]).call() == await fund.methods.beneficiariesPool(accounts[1]).call());
        assert.ok(await collateral.methods.collateralPaymentBank(accounts[0]).call() == await collateral.methods.collateralPaymentBank(accounts[1]).call());
    });
    

    it('does not produce weird behaviour when theres only 2 participants, and one pays and the other doesnt 2', async function() {
        this.timeout(200000);

        // First participant pays, second doesn't
        await usdc.methods.approve(fund.options.address, contributionAmount * 10 ** 6).send({ from: accounts[1] });
        await fund.methods.payContribution().send({ from: accounts[1] });

        // Artifically increase time to skip the wait
        await network.provider.send("evm_increaseTime", [contributionPeriod + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.closeFundingPeriod().send({
            from: accounts[12]
        });
    
        await network.provider.send("evm_increaseTime", [cycleTime + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.startNewCycle().send({
            from: accounts[12]
        });

        // Second participant pays, first doesn't
        await usdc.methods.approve(fund.options.address, contributionAmount * 10 ** 6).send({ from: accounts[0] });
        await fund.methods.payContribution().send({ from: accounts[0] });

        // Artifically increase time to skip the wait
        await network.provider.send("evm_increaseTime", [contributionPeriod + 1]);
        await network.provider.send("evm_mine");
        await fund.methods.closeFundingPeriod().send({
            from: accounts[12]
        });

        assert.ok(await fund.methods.beneficiariesPool(accounts[0]).call() == await fund.methods.beneficiariesPool(accounts[1]).call());
        assert.ok(await collateral.methods.collateralPaymentBank(accounts[0]).call() == await collateral.methods.collateralPaymentBank(accounts[1]).call());
    });
});