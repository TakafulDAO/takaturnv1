// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./Fund.sol";
import "./Collateral.sol";
import "hardhat/console.sol";

contract ReentrancyTest {
    uint public balance;

    Collateral collateral;
    Fund fund;
    
    function initializeCollateral(address _collateralAddress) public {
        collateral = Collateral(_collateralAddress);
    }

    function initializeFund(address _fundAddress) public {
        fund = Fund(_fundAddress);
    }

    function depositCollateral() external payable {
        collateral.depositCollateral{value:msg.value}();
    }

    function withdraw() external {
        fund.withdrawFund();
    }

    function withdrawCollateral() payable external {
        collateral.withdrawCollateral();
    }

    function withdrawReimbursement() external {
        collateral.withdrawReimbursement(address(this));
    }

    receive() external payable{
        if (address(collateral).balance >= 1000000 wei) {
            collateral.withdrawCollateral();
        }
    }

    function getBalance() external view returns (uint) {
        return address(this).balance;
    }

    function transferBalance() external {
        address payable sender = payable(msg.sender);
        sender.transfer(address(this).balance);
    }
}