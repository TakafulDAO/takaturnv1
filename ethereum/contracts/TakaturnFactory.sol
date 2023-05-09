// SPDX-License-Identifier: GPL-3.0        

pragma solidity ^0.8.9;

import "./ITakaturnFactory.sol";
import "./Collateral.sol";
import "./Fund.sol";

/// @title Takaturn Factory
/// @author Aisha El Allam / Mohammed Haddouti
/// @notice This is used to deploy the collateral & fund contracts
/// @dev v2.0 (post-deploy)
contract TakaturnFactory is ITakaturnFactory {

    uint constant public version = 2;

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
    ) external returns (address) {
        address newCollateral = address(
            new Collateral(
                totalParticipants,
                cycleTime,
                contributionAmount,
                contributionPeriod,
                collateralAmount,
                fixedCollateralEth,
                stableCoinAddress,
                aggregatorAddress,
                msg.sender
            )
        );
        deployedCollaterals.push(newCollateral);

        return newCollateral;
    }

    /// @notice Calls the Fund constructor to start he fund
    /// @dev The inputs must be revised / add try catch (see: https://solidity-by-example.org/try-catch/)
    /// @param _stableTokenAddress Address of the stable token contract
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
            new Fund(
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