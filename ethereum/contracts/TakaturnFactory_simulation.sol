// SPDX-License-Identifier: GPL-3.0        

pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./ITakaturnFactory.sol";
import "./Collateral_simulation.sol";
import "./Fund_simulation.sol";

/// @title Takaturn Factory
/// @author Aisha EL Allam
/// @notice This is used to operate the Takaturn fund
/// @dev v1.5 (prebeta 2)
/// @custom:experimental This is still in testing phase.
contract TakaturnFactory_sim is ITakaturnFactory, Ownable {

    address[] public deployedCollaterals;
    address[] public deployedFunds;

    function createCollateral(
        uint totalParticipants,
        uint cycleTime,
        uint contributionAmount,
        uint contributionPeriod,
        uint collateralAmount,
        uint fixedCollateralEth,
        address stableCoinAddress,
        address aggregatorAddress
    ) external onlyOwner returns (address) {
        address newCollateral = address(
            new Collateral_sim(
                totalParticipants,
                cycleTime,
                contributionAmount,
                contributionPeriod,
                collateralAmount,
                fixedCollateralEth,
                address(stableCoinAddress),
                address(aggregatorAddress),
                msg.sender
            )
        );
        deployedCollaterals.push(payable(newCollateral));

        return newCollateral;
    }

    /// @notice Calls the Fund constructor to start he fund
    /// @dev The inputs must be revised / add try catch (see: https://solidity-by-example.org/try-catch/)
    /// @param _participantsArray Max number of participants
    /// @param _cycleTime Duration of a complete cycle in seconds
    /// @param _contributionAmount Value participant must contribute for each cycle
    /// @param _contributionPeriod Duration of funding period in seconds?
    function createFund(
        address _stableTokenAddress,
        address[] memory _participantsArray,
        uint _cycleTime,
        uint _contributionAmount,
        uint _contributionPeriod
    ) external returns (address) {
        address newFund = address(
            new Fund_sim(
                _stableTokenAddress,
                _participantsArray,
                _cycleTime,
                _contributionAmount,
                _contributionPeriod,
                msg.sender
            )
        );
        deployedFunds.push(newFund);

        return newFund;
    }

    function getDeployedCollaterals()
        external
        view
        returns (address[] memory)
    {
        return deployedCollaterals;
    }

    function getDeployedFunds()
        external
        view
        returns (address[] memory)
    {
        return deployedFunds;
    }
}